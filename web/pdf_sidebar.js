/* Copyright 2016 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define('pdfjs-web/pdf_sidebar', ['exports',
      'pdfjs-web/pdf_rendering_queue', 'pdfjs-web/ui_utils'], factory);
  } else if (typeof exports !== 'undefined') {
    factory(exports, require('./pdf_rendering_queue.js'),
      require('./ui_utils.js'));
  } else {
    factory((root.pdfjsWebPDFSidebar = {}), root.pdfjsWebPDFRenderingQueue,
      root.pdfjsWebUIUtils);
  }
}(this, function (exports, pdfRenderingQueue, uiUtils) {

  var RenderingStates = pdfRenderingQueue.RenderingStates;
  var mozL10n = uiUtils.mozL10n;

  var UI_NOTIFICATION_CLASS = 'pdfSidebarNotification';

  var SidebarView = {
    NONE: 0,
    THUMBS: 1,
    OUTLINE: 2,
    ATTACHMENTS: 3
  };

  /**
   * @typedef {Object} PDFSidebarOptions
   * @property {PDFViewer} pdfViewer - The document viewer.
   * @property {PDFThumbnailViewer} pdfThumbnailViewer - The thumbnail viewer.
   * @property {PDFOutlineViewer} pdfOutlineViewer - The outline viewer.
   * @property {HTMLDivElement} mainContainer - The main container
   *   (in which the viewer element is placed).
   * @property {HTMLDivElement} outerContainer - The outer container
   *   (encasing both the viewer and sidebar elements).
   * @property {EventBus} eventBus - The application event bus.
   * @property {HTMLButtonElement} toggleButton - The button used for
   *   opening/closing the sidebar.
   * @property {HTMLButtonElement} thumbnailButton - The button used to show
   *   the thumbnail view.
   * @property {HTMLButtonElement} outlineButton - The button used to show
   *   the outline view.
   * @property {HTMLButtonElement} attachmentsButton - The button used to show
   *   the attachments view.
   * @property {HTMLDivElement} thumbnailView - The container in which
   *   the thumbnails are placed.
   * @property {HTMLDivElement} outlineView - The container in which
   *   the outline is placed.
   * @property {HTMLDivElement} attachmentsView - The container in which
   *   the attachments are placed.
   * @property {boolean} disableNotification - (optional) Disable the notification
   *   for documents containing outline/attachments. The default value is `false`.
   */

  /**
   * @class
   */
  var PDFSidebar = (function PDFSidebarClosure() {
    /**
     * @constructs PDFSidebar
     * @param {PDFSidebarOptions} options
     */
    function PDFSidebar(options) {
      this.isOpen = false;
      this.active = SidebarView.THUMBS;
      this.isInitialViewSet = false;

      /**
       * Callback used when the sidebar has been opened/closed, to ensure that
       * the viewers (PDFViewer/PDFThumbnailViewer) are updated correctly.
       */
      this.onToggled = null;

      this.pdfViewer = options.pdfViewer;
      this.pdfThumbnailViewer = options.pdfThumbnailViewer;
      this.pdfOutlineViewer = options.pdfOutlineViewer;

      this.mainContainer = options.mainContainer;
      this.outerContainer = options.outerContainer;
      this.eventBus = options.eventBus;
      this.toggleButton = options.toggleButton;

      this.thumbnailButton = options.thumbnailButton;
      this.outlineButton = options.outlineButton;
      this.attachmentsButton = options.attachmentsButton;

      this.thumbnailView = options.thumbnailView;
      this.outlineView = options.outlineView;
      this.attachmentsView = options.attachmentsView;

      this.disableNotification = options.disableNotification || false;

      this._addEventListeners();
    }

    PDFSidebar.prototype = {
      reset: function PDFSidebar_reset() {
        this.isInitialViewSet = false;

        this._hideUINotification(null);
        this.switchView(SidebarView.THUMBS);

        this.outlineButton.disabled = false;
        this.attachmentsButton.disabled = false;
      },

      /**
       * @returns {number} One of the values in {SidebarView}.
       */
      get visibleView() {
        return (this.isOpen ? this.active : SidebarView.NONE);
      },

      get isThumbnailViewVisible() {
        return (this.isOpen && this.active === SidebarView.THUMBS);
      },

      get isOutlineViewVisible() {
        return (this.isOpen && this.active === SidebarView.OUTLINE);
      },

      get isAttachmentsViewVisible() {
        return (this.isOpen && this.active === SidebarView.ATTACHMENTS);
      },

      /**
       * @param {number} view - The sidebar view that should become visible,
       *                        must be one of the values in {SidebarView}.
       */
      setInitialView: function PDFSidebar_setInitialView(view) {
        if (this.isInitialViewSet) {
          return;
        }
        this.isInitialViewSet = true;

        if (this.isOpen && view === SidebarView.NONE) {
          this._dispatchEvent();
          // If the user has already manually opened the sidebar,
          // immediately closing it would be bad UX.
          return;
        }
        var isViewPreserved = (view === this.visibleView);
        this.switchView(view, /* forceOpen */ true);

        if (isViewPreserved) {
          // Prevent dispatching two back-to-back `sidebarviewchanged` events,
          // since `this.switchView` dispatched the event if the view changed.
          this._dispatchEvent();
        }
      },

      /**
       * @param {number} view - The sidebar view that should be switched to,
       *                        must be one of the values in {SidebarView}.
       * @param {boolean} forceOpen - (optional) Ensure that the sidebar is open.
       *                              The default value is false.
       */
      switchView: function PDFSidebar_switchView(view, forceOpen) {
        if (view === SidebarView.NONE) {
          this.close();
          return;
        }
        var isViewChanged = (view !== this.active);
        var shouldForceRendering = false;

        switch (view) {
          case SidebarView.THUMBS:
            this.thumbnailButton.classList.add('toggled');
            this.outlineButton.classList.remove('toggled');
            this.attachmentsButton.classList.remove('toggled');

            this.thumbnailView.classList.remove('hidden');
            this.outlineView.classList.add('hidden');
            this.attachmentsView.classList.add('hidden');

            if (this.isOpen && isViewChanged) {
              this._updateThumbnailViewer();
              shouldForceRendering = true;
            }
            break;
          case SidebarView.OUTLINE:
            if (this.outlineButton.disabled) {
              return;
            }
            this.thumbnailButton.classList.remove('toggled');
            this.outlineButton.classList.add('toggled');
            this.attachmentsButton.classList.remove('toggled');

            this.thumbnailView.classList.add('hidden');
            this.outlineView.classList.remove('hidden');
            this.attachmentsView.classList.add('hidden');
            break;
          case SidebarView.ATTACHMENTS:
            if (this.attachmentsButton.disabled) {
              return;
            }
            this.thumbnailButton.classList.remove('toggled');
            this.outlineButton.classList.remove('toggled');
            this.attachmentsButton.classList.add('toggled');

            this.thumbnailView.classList.add('hidden');
            this.outlineView.classList.add('hidden');
            this.attachmentsView.classList.remove('hidden');
            break;
          default:
            console.error('PDFSidebar_switchView: "' + view +
              '" is an unsupported value.');
            return;
        }
        // Update the active view *after* it has been validated above,
        // in order to prevent setting it to an invalid state.
        this.active = view | 0;

        if (forceOpen && !this.isOpen) {
          this.open();
          return; // NOTE: Opening will trigger rendering, and dispatch the event.
        }
        if (shouldForceRendering) {
          this._forceRendering();
        }
        if (isViewChanged) {
          this._dispatchEvent();
        }
        this._hideUINotification(this.active);
      },

      open: function PDFSidebar_open() {
        if (this.isOpen) {
          return;
        }
        this.isOpen = true;
        this.toggleButton.classList.add('toggled');

        this.outerContainer.classList.add('sidebarMoving');
        this.outerContainer.classList.add('sidebarOpen');

        if (this.active === SidebarView.THUMBS) {
          this._updateThumbnailViewer();
        }
        this._forceRendering();
        this._dispatchEvent();

        this._hideUINotification(this.active);
      },

      close: function PDFSidebar_close() {
        if (!this.isOpen) {
          return;
        }
        this.isOpen = false;
        this.toggleButton.classList.remove('toggled');

        this.outerContainer.classList.add('sidebarMoving');
        this.outerContainer.classList.remove('sidebarOpen');

        this._forceRendering();
        this._dispatchEvent();
      },

      toggle: function PDFSidebar_toggle() {
        if (this.isOpen) {
          this.close();
        } else {
          this.open();
        }
      },

      /**
       * @private
       */
      _dispatchEvent: function PDFSidebar_dispatchEvent() {
        this.eventBus.dispatch('sidebarviewchanged', {
          source: this,
          view: this.visibleView,
        });
      },

      /**
       * @private
       */
      _forceRendering: function PDFSidebar_forceRendering() {
        if (this.onToggled) {
          this.onToggled();
        } else { // Fallback
          this.pdfViewer.forceRendering();
          this.pdfThumbnailViewer.forceRendering();
        }
      },

      /**
       * @private
       */
      _updateThumbnailViewer: function PDFSidebar_updateThumbnailViewer() {
        var pdfViewer = this.pdfViewer;
        var thumbnailViewer = this.pdfThumbnailViewer;

        // Use the rendered pages to set the corresponding thumbnail images.
        var pagesCount = pdfViewer.pagesCount;
        for (var pageIndex = 0; pageIndex < pagesCount; pageIndex++) {
          var pageView = pdfViewer.getPageView(pageIndex);
          if (pageView && pageView.renderingState === RenderingStates.FINISHED) {
            var thumbnailView = thumbnailViewer.getThumbnail(pageIndex);
            thumbnailView.setImage(pageView);
          }
        }
        thumbnailViewer.scrollThumbnailIntoView(pdfViewer.currentPageNumber);
      },

      /**
       * @private
       */
      _showUINotification: function (view) {
        if (this.disableNotification) {
          return;
        }

        this.toggleButton.title = mozL10n.get('toggle_sidebar_notification.title',
          null, 'Toggle Sidebar (document contains outline/attachments)');

        if (!this.isOpen) {
          // Only show the notification on the `toggleButton` if the sidebar is
          // currently closed, to avoid unnecessarily bothering the user.
          this.toggleButton.classList.add(UI_NOTIFICATION_CLASS);
        } else if (view === this.active) {
          // If the sidebar is currently open *and* the `view` is visible, do not
          // bother the user with a notification on the corresponding button.
          return;
        }

        switch (view) {
          case SidebarView.OUTLINE:
            this.outlineButton.classList.add(UI_NOTIFICATION_CLASS);
            break;
          case SidebarView.ATTACHMENTS:
            this.attachmentsButton.classList.add(UI_NOTIFICATION_CLASS);
            break;
        }
      },

      /**
       * @private
       */
      _hideUINotification: function (view) {
        if (this.disableNotification) {
          return;
        }

        var removeNotification = function (view) {
          switch (view) {
            case SidebarView.OUTLINE:
              this.outlineButton.classList.remove(UI_NOTIFICATION_CLASS);
              break;
            case SidebarView.ATTACHMENTS:
              this.attachmentsButton.classList.remove(UI_NOTIFICATION_CLASS);
              break;
          }
        }.bind(this);

        if (!this.isOpen && view !== null) {
          // Only hide the notifications when the sidebar is currently open,
          // or when it is being reset (i.e. `view === null`).
          return;
        }
        this.toggleButton.classList.remove(UI_NOTIFICATION_CLASS);

        if (view !== null) {
          removeNotification(view);
          return;
        }
        for (view in SidebarView) { // Remove all sidebar notifications on reset.
          removeNotification(SidebarView[view]);
        }

        this.toggleButton.title = mozL10n.get('toggle_sidebar.title', null,
          'Toggle Sidebar');
      },

      /**
       * @private
       */
      _addEventListeners: function PDFSidebar_addEventListeners() {
        var self = this;

        self.mainContainer.addEventListener('transitionend', function (evt) {
          if (evt.target === /* mainContainer */ this) {
            self.outerContainer.classList.remove('sidebarMoving');
          }
        });

        // Buttons for switching views.
        self.thumbnailButton.addEventListener('click', function () {
          self.switchView(SidebarView.THUMBS);
        });

        self.outlineButton.addEventListener('click', function () {
          self.switchView(SidebarView.OUTLINE);
        });
        self.outlineButton.addEventListener('dblclick', function () {
          self.pdfOutlineViewer.toggleOutlineTree();
        });

        self.attachmentsButton.addEventListener('click', function () {
          self.switchView(SidebarView.ATTACHMENTS);
        });

        // Disable/enable views.
        self.eventBus.on('outlineloaded', function (e) {
          var outlineCount = e.outlineCount;

          self.outlineButton.disabled = !outlineCount;

          if (outlineCount) {
            self._showUINotification(SidebarView.OUTLINE);
          } else if (self.active === SidebarView.OUTLINE) {
            // If the outline view was opened during document load, switch away
            // from it if it turns out that the document has no outline.
            self.switchView(SidebarView.THUMBS);
          }
        });

        self.eventBus.on('attachmentsloaded', function (e) {
          var attachmentsCount = e.attachmentsCount;

          self.attachmentsButton.disabled = !attachmentsCount;

          if (attachmentsCount) {
            self.switchView(SidebarView.ATTACHMENTS);
            !self.isOpen && self.open();
            // self._showUINotification(SidebarView.ATTACHMENTS);
          } else if (self.active === SidebarView.ATTACHMENTS) {
            // If the attachment view was opened during document load, switch away
            // from it if it turns out that the document has no attachments.
            self.switchView(SidebarView.THUMBS);
          }
        });
        // Update the thumbnailViewer, if visible, when exiting presentation mode.
        self.eventBus.on('presentationmodechanged', function (e) {
          if (!e.active && !e.switchInProgress && self.isThumbnailViewVisible) {
            self._updateThumbnailViewer();
          }
        });
      },
    };

    return PDFSidebar;
  })();

  exports.SidebarView = SidebarView;
  exports.PDFSidebar = PDFSidebar;
}));
