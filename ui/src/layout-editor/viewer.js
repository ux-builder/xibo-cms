// VIEWER Module

// Load templates
const viewerTemplate = require('../templates/viewer.hbs');
const viewerWidgetTemplate = require('../templates/viewer-widget.hbs');
const viewerLayoutPreview = require('../templates/viewer-layout-preview.hbs');
const viewerActionEditRegionTemplate =
  require('../templates/viewer-action-edit-region.hbs');
const loadingTemplate = require('../templates/loading.hbs');

/**
 * Viewer contructor
 * @param {object} parent - Parent object
 * @param {object} container - the container to render the viewer to
 */
const Viewer = function(parent, container) {
  this.parent = parent;
  this.DOMObject = container;

  // First load
  this.reload = true;

  // Element dimensions inside the viewer container
  this.containerElementDimensions = null;

  // State of the inline editor (  0: off, 1: on, 2: edit )
  this.inlineEditorState = 0;

  // If the viewer is currently playing the preview
  this.previewPlaying = false;

  // Theme ( light / dark)
  this.theme = 'light';

  // Moveable object
  this.moveable = null;

  // Initialise moveable
  this.initMoveable();
};

/**
 * Calculate element scale to fit inside the container
 * @param {object} element - original object to be rendered
 * @param {object} container - container to render the element to
 * @return {object} Object containing dimensions for the object
 */
Viewer.prototype.scaleElement = function(element, container) {
  // Get container dimensions
  const containerDimensions = {
    width: container.width(),
    height: container.height(),
  };

  // Get element dimensions
  const elementDimensions = {
    width: parseFloat(
      (element.dimensions) ? element.dimensions.width : element.width),
    height: parseFloat(
      (element.dimensions) ? element.dimensions.height : element.height),
    scale: 1,
    top: 0,
    left: 0,
  };

  // Calculate ratio
  const elementRatio = elementDimensions.width / elementDimensions.height;
  const containerRatio = containerDimensions.width / containerDimensions.height;

  // Calculate scale factor
  if (elementRatio > containerRatio) {
    // element is more "landscapish" than the container
    // Scale is calculated using width
    elementDimensions.scale =
      containerDimensions.width / elementDimensions.width;
  } else {
    // Same ratio or the container is the most "landscapish"
    // Scale is calculated using height
    elementDimensions.scale =
      containerDimensions.height / elementDimensions.height;
  }

  // Calculate new values for the element using the scale factor
  elementDimensions.width *= elementDimensions.scale;
  elementDimensions.height *= elementDimensions.scale;

  // Calculate top and left values to centre the element in the container
  elementDimensions.top =
    containerDimensions.height / 2 - elementDimensions.height / 2;
  elementDimensions.left =
    containerDimensions.width / 2 - elementDimensions.width / 2;

  return elementDimensions;
};


/**
 * Render viewer
 * @param {object} forceReload - Force reload
*/
Viewer.prototype.render = function(forceReload = false) {
  const self = this;

  // Check background colour and set theme
  // eslint-disable-next-line new-cap
  const hsvColor = Color(this.parent.layout.backgroundColor);
  if (
    (
      hsvColor.values.hsv[2] > 75 &&
      hsvColor.values.hsv[1] < 50
    ) ||
    hsvColor.values.hsv[2] > 90
  ) {
    this.theme = 'dark';
  } else {
    this.theme = 'light';
  }

  // Refresh if it's not the reload
  if (!forceReload && !this.reload) {
    this.update();
    return;
  }

  // Set reload to false
  this.reload = false;

  // Render the viewer
  this.DOMObject.html(viewerTemplate());

  const $viewerContainer = this.DOMObject;

  // If preview is playing, refresh the bottombar
  if (this.previewPlaying && this.parent.selectedObject.type == 'layout') {
    this.parent.bottombar.render(this.parent.selectedObject);
  }

  // Show loading template
  $viewerContainer.html(loadingTemplate());

  // Set preview play as false
  this.previewPlaying = false;

  // Reset container properties
  $viewerContainer.css('background',
    (this.theme == 'dark') ? '#2c2d2e' : '#d8dce1',
  );
  $viewerContainer.css('border', 'none');

  // Apply viewer scale to the layout
  this.containerElementDimensions =
    this.scaleElement(lD.layout, $viewerContainer);

  // Apply viewer scale to the layout
  const scaledLayout = lD.layout.scale($viewerContainer);

  const html = viewerTemplate({
    type: 'layout',
    renderLayout: true,
    containerStyle: 'layout-player',
    dimensions: this.containerElementDimensions,
    layout: scaledLayout,
    trans: viewerTrans,
    theme: this.theme,
  });

  // Replace container html
  $viewerContainer.html(html);

  // Render background image or color to the preview
  if (lD.layout.backgroundImage === null) {
    $viewerContainer.find('.viewer-element')
      .css('background', lD.layout.backgroundColor);
  } else {
    // Get API link
    let linkToAPI = urlsForApi.layout.downloadBackground.url;
    // Replace ID in the link
    linkToAPI = linkToAPI.replace(':id', lD.layout.layoutId);

    $viewerContainer.find('.viewer-element')
      .css(
        'background',
        'url(\'' + linkToAPI + '?preview=1&width=' +
        (lD.layout.width * this.containerElementDimensions.scale) +
        '&height=' +
        (
          lD.layout.height *
          this.containerElementDimensions.scale
        ) +
        '&proportional=0&layoutBackgroundId=' +
        lD.layout.backgroundImage + '\') top center no-repeat',
      );
  }

  // Render preview regions/widgets
  for (const regionIndex in lD.layout.regions) {
    if (lD.layout.regions.hasOwnProperty(regionIndex)) {
      this.renderRegion(lD.layout.regions[regionIndex]);
    }
  }

  // Handle droppable layout area
  const $droppableArea = $viewerContainer.find('.layout.droppable');
  $droppableArea.droppable({
    greedy: true,
    accept: (draggable) => {
      // Check target
      return lD.common.hasTarget(draggable, 'layout');
    },
    tolerance: 'pointer',
    drop: _.debounce(function(event, ui) {
      const draggableDimensions = {
        width: ui.draggable.width(),
        height: ui.draggable.height(),
      };

      const droppableAreaPosition = {
        x: $droppableArea.offset().left,
        y: $droppableArea.offset().top,
      };

      // Get position, event location
      // adjusted with the viewer container
      // and the helper offset
      const position = {
        top: event.pageY -
          droppableAreaPosition.y -
          (draggableDimensions.height / 2),
        left: event.pageX -
          droppableAreaPosition.x -
          (draggableDimensions.width / 2),
      };

      // Scale value to original size ( and parse to int )
      position.top = parseInt(
        position.top /
        self.containerElementDimensions.scale);
      position.left = parseInt(
        position.left /
        self.containerElementDimensions.scale);

      lD.dropItemAdd(event.target, ui.draggable[0], position);
    }, 200),
    activate: function(_event, ui) {
      // if draggable is an action, add special class
      if ($(ui.draggable).data('type') == 'actions') {
        $(this).addClass('ui-droppable-actions-target');
      }
    },
  });

  // Handle droppable on the main container
  $viewerContainer.droppable({
    greedy: true,
    accept: (draggable) => {
      // Check target
      return lD.common.hasTarget(draggable, 'layout');
    },
    tolerance: 'pointer',
    drop: _.debounce(function(event, ui) {
      lD.dropItemAdd(event.target, ui.draggable[0]);
    }, 200),
    activate: function(_event, ui) {
      // if draggable is an action, add special class
      if ($(ui.draggable).data('type') == 'actions') {
        $(this).addClass('ui-droppable-actions-target');
      }
    },
  });

  // Handle droppable empty regions ( zones )
  this.DOMObject.find(
    '.designer-region.designer-region-zone',
  ).droppable({
    greedy: true,
    tolerance: 'pointer',
    accept: (draggable) => {
      // Check target
      return lD.common.hasTarget(draggable, 'zone');
    },
    drop: _.debounce(function(event, ui) {
      lD.dropItemAdd(event.target, ui.draggable[0]);
    }, 200),
  });

  // Handle droppable empty regions ( playlist )
  this.DOMObject.find(
    '.designer-region.designer-region-playlist',
  ).droppable({
    greedy: true,
    tolerance: 'pointer',
    accept: (draggable) => {
      // Check target
      return lD.common.hasTarget(draggable, 'playlist');
    },
    drop: _.debounce(function(event, ui) {
      lD.dropItemAdd(event.target, ui.draggable[0]);
    }, 200),
  });

  // Handle click and double click
  let clicks = 0;
  let timer = null;
  $viewerContainer.parent().find('.viewer-element-select').off()
    .on('mousedown', function(e) {
      e.stopPropagation();

      // Right click open context menu
      if (e.which == 3) {
        return;
      }

      // Get click position
      const clickPosition = {
        left: e.pageX -
          $viewerContainer.find('.layout.viewer-element-select').offset().left,
        top: e.pageY -
          $viewerContainer.find('.layout.viewer-element-select').offset().top,
      };

      // Scale value to original size ( and parse to int )
      clickPosition.top = parseInt(
        clickPosition.top /
        self.containerElementDimensions.scale);
      clickPosition.left = parseInt(
        clickPosition.left /
        self.containerElementDimensions.scale);

      // Click on layout or layout wrapper to clear selection
      // or add item to the layout
      if (
        $(e.target).hasClass('ui-droppable-actions-target')
      ) {
        // Add action to the selected object
        lD.selectObject({
          target: $(e.target),
          forceSelect: true,
        });
      } else if (
        (
          $(e.target).hasClass('designer-region-zone') ||
          $(e.target).hasClass('designer-region-playlist')
        ) &&
        $(e.target).hasClass('ui-droppable-active')
      ) {
        // Add item to the selected region
        lD.selectObject({
          target: $(e.target),
          forceSelect: true,
        });
      } else if (
        $(e.target).hasClass('layout-wrapper') ||
        $(e.target).hasClass('layout')
      ) {
        // Clear selected object
        lD.selectObject({
          target: null,
          reloadViewer: false,
          clickPosition: $(e.target).hasClass('layout') ? clickPosition : null,
        });
        self.selectElement();
      } else {
        // Select elements inside the layout
        clicks++;

        // Single click
        if (clicks === 1 && e.which === 1) {
          timer = setTimeout(function() {
            // Single click action
            clicks = 0;

            if (
              $(e.target).data('subType') === 'playlist' &&
              !$(e.target).hasClass('selected')
            ) {
              // Edit region if it's a playlist
              // Get region object
              const regionObject =
                lD.getElementByTypeAndId('region', $(e.target).attr('id'));
              // Open playlist editor
              lD.openPlaylistEditor(
                regionObject.playlists.playlistId,
                regionObject);
            } else if (
              $(e.target).find('.designer-widget').length > 0 &&
              !$(e.target).find('.designer-widget').hasClass('selected') &&
              !$(e.target).hasClass('selected')
            ) {
              // Select widget if exists
              lD.selectObject({
                target: $(e.target).find('.designer-widget'),
              });
              self.selectElement($(e.target).find('.designer-widget'));
            }
          }, 200);
        } else {
          // Double click action
          clearTimeout(timer);
          clicks = 0;

          // Select region ( if not selected )
          if (!$(e.target).hasClass('selected')) {
            lD.selectObject({
              target: $(e.target),
            });
            self.selectElement($(e.target));
          } else {
            // Move out from region editing
            lD.selectObject();
            self.selectElement();
          }
        }
      }
    }).on('dblclick', function(e) {
      // Cancel default double click
      e.preventDefault();
    }).children().on('mousedown dblclick', function(e) {
      // Cancel default click
      e.stopPropagation();
    }).contextmenu(function(ev) {
      // Context menu
      if (
        $(ev.target).is('.editable, .deletable, .permissionsModifiable')
      ) {
        // Open context menu
        lD.openContextMenu(ev.target, {
          x: ev.pageX,
          y: ev.pageY,
        });
      }
      // Prevent browser menu to open
      return false;
    });

  // Handle fullscreen button
  $viewerContainer.parent().find('#fullscreenBtn').off().click(function() {
    this.reload = true;
    this.toggleFullscreen();
  }.bind(this));

  // Refresh on window resize
  $(window).on('resize', function() {
    this.update();
  }.bind(this));

  // Update moveable
  this.updateMoveable();
};

/**
 * Update Viewer
 */
Viewer.prototype.update = function() {
  const $viewerContainer = this.DOMObject;
  const $viewElement = $viewerContainer.find('.viewer-element');

  // Hide viewer element
  $viewElement.hide();

  // Apply viewer scale to the layout
  this.containerElementDimensions =
    this.scaleElement(lD.layout, $viewerContainer);

  // Apply viewer scale to the layout
  lD.layout.scale($viewerContainer);

  $viewElement.css({
    width: this.containerElementDimensions.width,
    height: this.containerElementDimensions.height,
    top: this.containerElementDimensions.top,
    left: this.containerElementDimensions.left,
    scale: this.containerElementDimensions.scale,
  });

  // Show viewer element
  $viewElement.show();

  // Render preview regions/widgets
  for (const regionIndex in lD.layout.regions) {
    if (lD.layout.regions.hasOwnProperty(regionIndex)) {
      this.updateRegion(lD.layout.regions[regionIndex]);
    }
  }

  // Update action helper if exists
  $viewElement.find('.designer-region-drawer').each(function() {
    this.updateRegion(
      lD.layout.drawer,
      ($viewElement.data('target') == 'layout'),
    );
  }.bind(this));

  // Update moveable
  this.updateMoveable();
};

/**
 * Render widget in region container
 * @param {object} region - region object
 * @param {object} widgetToLoad - widget object to render
 * @return {jqXHR} - ajax request object
 */
Viewer.prototype.renderRegion = function(
  region,
  widgetToLoad = null,
) {
  const self = this;
  const $container = this.DOMObject.find(`#${region.id}`);

  // Get first widget of the region
  const widget = (widgetToLoad) ?
    widgetToLoad :
    region.widgets[Object.keys(region.widgets)[0]];

  // If there's no widget, return
  if (!widget && region.subType != 'playlist') {
    return;
  }

  // If there was still a render request, abort it
  if (
    this.renderRequest != undefined &&
    this.renderRequest.target == $container
  ) {
    this.renderRequest.abort('requestAborted');
  }

  // Show loading
  $container.html(loadingTemplate());

  // Apply scaling
  const containerElementDimensions = {
    width: $container.width(),
    height: $container.height(),
  };

  // Get request path
  let requestPath = urlsForApi.region.preview.url;
  requestPath = requestPath.replace(
    ':id',
    region['regionId'],
  );

  requestPath +=
    '?width=' + containerElementDimensions.width +
    '&height=' + containerElementDimensions.height;

  // If it's not a playlist, add widget to request
  if (region.subType != 'playlist') {
    requestPath += '&widgetId=' + widget['widgetId'];
  }

  // Get HTML for the given element from the API
  this.renderRequest = {
    target: $container,
  };

  // If region is selected, update moveable
  if (region.selected) {
    this.selectElement($container);
  }

  this.renderRequest.request = $.get(requestPath).done(function(res) {
    // Clear request var after response
    self.renderRequest = undefined;

    // Prevent rendering null html
    if (!res.success) {
      toastr.error(res.message);
      $container.html(res.message);
      return;
    }

    const options = {
      res: res,
      regionId: region['id'],
      trans: viewerTrans,
    };

    if (region.subType == 'playlist') {
      $.extend(true, options, {
        elementType: 'playlist',
      });
    } else {
      $.extend(true, options, {
        id: widget.id,
        widgetId: widget.widgetId,
        elementType: (widget.type + '_' + widget.subType),
        editable: widget.isEditable,
        parentId: widget.regionId,
        selected: widget.selected,
      });
    }

    $.extend(toolbarTrans, topbarTrans);

    // Replace container html
    const html = viewerWidgetTemplate(options);

    // Append layout html to the container div
    $container.html(html);

    // Select droppables in the region
    let $droppables = $container.find('.droppable');

    // Check if region is also a droppable
    // if so, add it to the droppables
    if ($container.hasClass('droppable')) {
      $droppables = $.merge($droppables, $container);
    }

    // Init droppables
    $droppables.droppable({
      greedy: true,
      tolerance: 'pointer',
      accept: function(draggable) {
        // Get type ( if region, get subType )
        const dataType =
          ($(this).hasClass('designer-region')) ?
            $(this).data('subType') :
            $(this).data('type');

        // Check target
        return lD.common.hasTarget(draggable, dataType);
      },
      drop: _.debounce(function(event, ui) {
        lD.dropItemAdd(event.target, ui.draggable[0]);
      }, 200),
      activate: function(_event, ui) {
        // if draggable is an action, add special class
        if ($(ui.draggable).data('type') == 'actions') {
          $(this).addClass('ui-droppable-actions-target');
        }
      },
    });

    // Update navbar
    lD.bottombar.render(
      (widgetToLoad) ? widgetToLoad : lD.selectedObject,
      res,
    );

    // If inline editor is on, show the controls for it
    // ( fixing asyc load problem )
    if (lD.propertiesPanel.inlineEditor) {
      // Show inline editor controls
      this.showInlineEditor();
    }

    // Force scale region container
    // by updating region
    self.updateRegion(region);
  }.bind(this)).fail(function(res) {
    // Clear request var after response
    self.renderRequest = undefined;

    if (res.statusText != 'requestAborted') {
      toastr.error(errorMessagesTrans.previewFailed);
      $container.html(errorMessagesTrans.previewFailed);
    }
  });

  // Return request
  return this.renderRequest;
};

/**
 * Update Region
 * @param {object} region - region object
 */
Viewer.prototype.updateRegion = function(
  region,
) {
  const $container = this.DOMObject.find(`#${region.id}`);

  // If drawer and has target region, set dimensions
  // to be the same as it
  if (
    region.isDrawer &&
    $container.data('targetRegionDimensions') != undefined
  ) {
    region.dimensions = $container.data('targetRegionDimensions');
    region.zIndex = $container.data('targetRegionzIndex');
  }

  // Calculate scaled dimensions
  region.scaledDimensions = {
    height: region.dimensions.height * this.containerElementDimensions.scale,
    left: region.dimensions.left * this.containerElementDimensions.scale,
    top: region.dimensions.top * this.containerElementDimensions.scale,
    width: region.dimensions.width * this.containerElementDimensions.scale,
  };

  // Update region container dimensions
  $container.css({
    height: region.scaledDimensions.height,
    left: region.scaledDimensions.left,
    top: region.scaledDimensions.top,
    width: region.scaledDimensions.width,
  });

  // Update z index if set
  if (region.zIndex != undefined) {
    $container.css('z-index', region.zIndex);
  }

  // Update region content
  this.updateRegionContent(region);

  // Update moveable
  this.updateMoveable();
};

/**
 * Play preview
 * @param {string} url - Preview url
 * @param {object} dimensions - Preview dimensions
 */
Viewer.prototype.playPreview = function(url, dimensions) {
  // Compile layout template with data
  const html = viewerLayoutPreview({
    url: url,
    width: dimensions.width,
    height: dimensions.height,
  });

  // Append layout html to the main div
  this.DOMObject.find('.layout-player').html(html);
};

/**
 * Toggle fullscreen
 */
Viewer.prototype.toggleFullscreen = function() {
  // If inline editor is opened, needs to be saved/closed
  if (this.inlineEditorState == 2) {
    // Close editor content
    this.closeInlineEditorContent();
  }

  this.DOMObject.parents('#layout-viewer-container').toggleClass('fullscreen');
  this.parent.editorContainer.toggleClass('fullscreen-mode');
  this.render(lD.selectedObject, lD.layout);
};

/**
 * Initialise moveable
 */
Viewer.prototype.initMoveable = function() {
  const self = this;
  /**
 * Save the new position of the region
 * @param {object} region - Region object
 * @param {boolean} updateRegion - Update region rendering
 * @param {boolean} hasMoved - Has region moved
 */
  const saveRegionProperties = function(
    region,
    updateRegion = true,
    hasMoved = false,
  ) {
    const scale = self.containerElementDimensions.scale;
    const regionId = $(region).attr('id');
    const transform = {
      width: parseInt($(region).width() / scale),
      height: parseInt($(region).height() / scale),
    };
    const regionObject = lD.layout.regions[regionId];

    // Only change top/left if region has moved
    if (hasMoved) {
      transform.top = parseInt($(region).position().top / scale);
      transform.left = parseInt($(region).position().left / scale);
    } else {
      transform.top = regionObject.dimensions.top;
      transform.left = regionObject.dimensions.left;
    }

    if (regionId == lD.selectedObject.id) {
      regionObject.transform(transform, false);

      if (typeof window.regionChangesForm === 'function') {
        window.regionChangesForm();
        lD.propertiesPanel.saveRegion();
        (updateRegion) &&
          lD.viewer.updateRegion(regionObject);
      }
    }
  };

  // Create moveable
  this.moveable = new Moveable(document.body, {
    draggable: true,
    resizable: true,
  });

  // Resize helper
  resizeFrame = {
    translate: [0, 0],
  };

  /* draggable */
  this.moveable.on('drag', (e) => {
    // Margin to prevent dragging outside of the container
    const remainingMargin = 20;

    // Update horizontal position
    // if not outside of the container
    if (
      e.left > -e.width + remainingMargin &&
      e.left + remainingMargin < this.containerElementDimensions.width
    ) {
      e.target.style.left = `${e.left}px`;
    }

    // Update vertical position
    // if not outside of the container
    if (
      e.top > -e.height + remainingMargin &&
      e.top + remainingMargin < this.containerElementDimensions.height
    ) {
      e.target.style.top = `${e.top}px`;
    }
  }).on('dragEnd', (e) => {
    (e.isDrag) && saveRegionProperties(e.target, false, true);
  });

  /* resizable */
  this.moveable.on('resizeStart', (e) => {
    e.setOrigin(['%', '%']);
    e.dragStart && e.dragStart.set(resizeFrame.translate);
  }).on('resize', (e) => {
    const beforeTranslate = e.drag.beforeTranslate;
    resizeFrame.translate = beforeTranslate;
    e.target.style.width = `${e.width}px`;
    e.target.style.height = `${e.height}px`;
    e.target.style.transform =
      `translate(${beforeTranslate[0]}px, ${beforeTranslate[1]}px)`;

    // Save new dimensions to region object
    lD.selectedObject.transform({
      width: parseInt(e.width / self.containerElementDimensions.scale),
      height: parseInt(e.height / self.containerElementDimensions.scale),
      top: lD.selectedObject.dimensions.top,
      left: lD.selectedObject.dimensions.left,
    }, false);

    // Update region
    self.updateRegion(lD.selectedObject);
  }).on('resizeEnd', (e) => {
    // Change transform translate to the new position
    const transformSplit = (e.target.style.transform).split(/[(),]+/);

    e.target.style.left =
      `${parseFloat(e.target.style.left) + parseFloat(transformSplit[1])}px`;
    e.target.style.top =
      `${parseFloat(e.target.style.top) + parseFloat(transformSplit[2])}px`;

    // Reset transform
    e.target.style.transform = '';

    // Check if the region moved when resizing
    const moved = (
      parseFloat(transformSplit[1]) != 0 ||
      parseFloat(transformSplit[2]) != 0
    );

    saveRegionProperties(e.target, true, moved);
  });
};

/**
 * Select element
 * @param {object} element - Element object
 */
Viewer.prototype.selectElement = function(element = null) {
  // Deselect all elements
  this.DOMObject.find('.selected').removeClass('selected');

  // Select element if exists
  if (element) {
    $(element).addClass('selected');
  }

  // Update moveable
  this.updateMoveable();
};

/**
 * Update moveable
 */
Viewer.prototype.updateMoveable = function() {
  // Get selected element
  const $selectedElement = this.DOMObject.find('.selected');

  // Update moveable if region is selected and belongs to the DOM
  if (
    $selectedElement &&
    (
      $selectedElement.hasClass('designer-region')
    ) &&
    $.contains(document, $selectedElement[0])
  ) {
    this.moveable.target = $selectedElement[0];
    this.moveable.updateRect();
  } else {
    this.moveable.target = null;
  }
};

/**
 * Update region content
 * @param {object} region - Region object
 */
Viewer.prototype.updateRegionContent = function(region) {
  const $container = this.DOMObject.find(`#${region.id}`);

  // Update iframe
  const updateIframe = function($iframe) {
    $iframe.css({
      width: region.scaledDimensions.width,
      height: region.scaledDimensions.height,
    });

    // Options for the message
    const options = {
      id: region.id,
      originalWidth: region.dimensions.width,
      originalHeight: region.dimensions.height,
    };

    // Check if it's the first call
    // If it is, send a flag to pause effects on start
    if (!$iframe.data('firstCall')) {
      $iframe.data('firstCall', true);
      options.pauseEffectOnStart = true;
    }

    // We need to recalculate the scale inside of the iframe
    $iframe[0].contentWindow
      .postMessage({
        method: 'renderContent',
        options: options,
      }, '*');
  };

  // Get iframe
  const $iframe = $container.find('iframe');

  // Check if iframe exists, and is loaded
  if ($iframe.length) {
    // If iframe globalOptions are not loaded
    // wait for the iframe to load
    if (!$iframe[0].contentWindow.window.globalOptions) {
      // Wait for the iframe to load and update it
      $iframe[0].onload = function() {
        updateIframe($iframe);
      };
    } else {
      // Update iframe
      updateIframe($iframe);
    }
  }

  // Process image
  const $imageContainer = $container.find('[data-type="widget_image"]');
  if ($imageContainer.length) {
    const $image = $imageContainer.find('img');
    const $imageParent = $image.parent();
    const $imageParentContainer = $image.parents('.img-container');
    const urlSplit = $image.attr('src').split('&proportional=');

    // If the URL is not parsed
    if (urlSplit.length > 1) {
      // Get image properties ( [proportional, fit])
      // Stretch/fill [0,0]
      // Centre/contain [1,0]
      // Fit/cover [1,1]
      const imgValues = urlSplit[1].split('&fit=');
      const objectFit = [
        ['fill', 'none'],
        ['contain', 'cover'],
      ];

      // Get object fit value
      const currentObjectFit = objectFit[imgValues[0]][imgValues[1]];

      // Get object position value
      // if center/contain, get values
      // if others, remove object position value
      const objectPosition = (currentObjectFit === 'contain') ?
        (
          $imageParent.css('text-align') +
          ' ' +
          $imageParent.css('vertical-align')
        ) :
        '';

      // Remove style properties in image's parent
      // They will be applied in the image itself
      $imageParent.css({
        'text-align': '',
        'vertical-align': '',
      });

      // Change only onload
      $image.on('load', () => {
        // Update image fit
        $image.css({
          'object-fit': currentObjectFit,
          'object-position': objectPosition,
        });
      });

      // Change image url to a non styled one
      // Which triggers the onload event
      $image.attr('src', urlSplit[0]);
    }

    // Update image container height
    $imageParentContainer.css({
      height: region.scaledDimensions.height,
    });

    // Update image dimensions
    $image.css({
      width: region.scaledDimensions.width,
      height: region.scaledDimensions.height,
    });
  }
};

/**
 * Highlight action targets on viewer
 * @param {string} actionData - Action data
 * @param {string} level - Highlight level (0 - Light, 1- Heavy)
 */
Viewer.prototype.createActionHighlights = function(actionData, level) {
  const self = this;

  const typeSelectorMap = {
    region: '.designer-region:not(.designer-region-playlist)',
    widget: '.designer-region:not(.designer-region-playlist) .designer-widget',
    layout: '.viewer-element.layout',
  };

  // Clear previous highlights
  this.clearActionHighlights();

  const highlightElement = function(elementType, elementId, highlightType) {
    // Find element on viewer
    const $viewerElement = self.DOMObject.find(
      typeSelectorMap[elementType] +
      '[data-' + elementType + '-id="' + elementId + '"]',
    );

    // Add highlight class
    $viewerElement.addClass(
      `action-highlight action-highlight-${highlightType} highlight-${level}`,
    );
  };

  // Get target if exists
  if (actionData.target) {
    // If target is "screen", use "layout" to highlight
    const targetType = (actionData.target === 'screen') ?
      'layout' :
      actionData.target;

    highlightElement(targetType, actionData.targetId, 'target');
  }

  // Get trigger if exists
  if (actionData.source) {
    highlightElement(actionData.source, actionData.sourceId, 'trigger');
  }
};

/**
 * Clear action highlights on viewer
 */
Viewer.prototype.clearActionHighlights = function() {
  this.DOMObject.find('.action-highlight').removeClass(
    'action-highlight action-highlight-target ' +
    'action-highlight-trigger highlight-0 highlight-1',
  );
};

/**
 * Add new widget action element
 * @param {object} actionData - Action data
 * @param {string} createOrEdit - Create or edit action
 */
Viewer.prototype.addActionEditArea = function(
  actionData,
  createOrEdit,
) {
  const self = this;
  const $layoutContainer = this.DOMObject.find('.viewer-element.layout');
  const createOverlayArea = function(type) {
    // If target is "screen", use "layout" to highlight
    const targetType =
      (actionData.target === 'screen') ? 'layout' : actionData.target;

    // Create overlay area
    const $actionArea = $(viewerActionEditRegionTemplate({
      drawer: lD.layout.drawer,
      target: targetType,
      type: type,
    }));

    // Set background to be the same as the layout
    $actionArea.css({
      'background-color': lD.layout.backgroundColor,
    });

    // Get target
    const $targetRegion = self.parent.getElementByTypeAndId(
      targetType,
      targetType + '_' + actionData.targetId,
    );

    // Update drawer dimensions to match target
    if (targetType === 'region') {
      lD.layout.drawer.dimensions = $targetRegion.dimensions;
      // Set the z index of the drawer to be over the target region
      lD.layout.drawer.zIndex = $targetRegion.zIndex + 1;
    } else if (targetType === 'layout') {
      lD.layout.drawer.dimensions = {
        width: lD.layout.width,
        height: lD.layout.height,
        top: 0,
        left: 0,
      };
      // Set the z index to 0
      lD.layout.drawer.zIndex = 0;
    }

    // Save dimensions to the DOM object
    $actionArea.data('targetRegionDimensions', lD.layout.drawer.dimensions);
    $actionArea.data('targetRegionzIndex', lD.layout.drawer.zIndex);

    // Add after region or
    // if layout, add inside regions in the layout as first element
    if (targetType === 'region') {
      $actionArea.insertAfter(self.DOMObject.find('#' + $targetRegion.id));
    } else if (targetType === 'layout') {
      $layoutContainer.find('#regions').prepend($actionArea);
    }

    return $actionArea;
  };

  // Remove previous action create/edit area
  this.removeActionEditArea();

  if (createOrEdit === 'create') {
    // Create add action area
    const $actionArea = createOverlayArea('create');

    // Add label to action area
    $actionArea.html('<div class="action-label">' +
      viewerTrans.addWidget +
      '</div>');

    // Click to add widget
    $actionArea.on('click', () => {
      lD.selectObject({
        target: $actionArea,
      });
    });

    // Create droppable area
    $actionArea.droppable({
      greedy: true,
      tolerance: 'pointer',
      accept: function(draggable) {
        // Check target
        return lD.common.hasTarget(draggable, 'drawer');
      },
      drop: _.debounce(function(event, ui) {
        lD.dropItemAdd(event.target, ui.draggable[0]);
      }, 200),
    });
  } else if (createOrEdit === 'edit') {
    // Create action edit area
    const $actionArea = createOverlayArea('edit');

    // Get widget from drawer be loaded
    const widgetToRender = lD.getElementByTypeAndId(
      'widget',
      'widget_' + lD.layout.drawer.regionId + '_' + actionData.widgetId,
      'drawer',
    );

    // Render region with widget
    this.renderRegion(
      lD.layout.drawer,
      widgetToRender,
      (actionData.target === 'layout'),
    );

    // Edit on click
    $actionArea.on('click', () => {
      // Open widget edit form
      lD.editDrawerWidget(
        actionData,
      );
    });
  }

  // Update viewer
  this.update();
};

/**
 * Remove new widget action element
 */
Viewer.prototype.removeActionEditArea = function() {
  this.DOMObject.find('.designer-region-drawer').remove();
};

module.exports = Viewer;
