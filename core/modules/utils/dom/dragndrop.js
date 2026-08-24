/*\
title: $:/core/modules/utils/dom/dragndrop.js
type: application/javascript
module-type: utils

Browser data transfer utilities, used with the clipboard and drag and drop

\*/

"use strict";

exports.makeDraggable = function(options) {
	var domNode = options.domNode,
		dragStates = options.dragStates || Object.create(null),
		dragThreshold = 4;

	domNode.setAttribute("draggable","false");

	function dispatchSyntheticEvent(target,eventType,pointerEvent) {
		if(!target) {
			return null;
		}

		var event = new Event(eventType,{
			bubbles: true,
			cancelable: true
		});

		event.clientX = pointerEvent.clientX;
		event.clientY = pointerEvent.clientY;
		event.screenX = pointerEvent.screenX;
		event.screenY = pointerEvent.screenY;
		event.pageX = pointerEvent.pageX;
		event.pageY = pointerEvent.pageY;
		event.pointerId = pointerEvent.pointerId;
		event.pointerType = pointerEvent.pointerType;
		event.buttons = pointerEvent.buttons;
		event.button = pointerEvent.button;
		event.ctrlKey = pointerEvent.ctrlKey;
		event.shiftKey = pointerEvent.shiftKey;
		event.altKey = pointerEvent.altKey;
		event.metaKey = pointerEvent.metaKey;

		target.dispatchEvent(event);

		return event;
	}

	function getDroppableTarget(event) {
		var element = document.elementFromPoint(
			event.clientX,
			event.clientY
		);

		if(!element) {
			return null;
		}

		return element.closest(
			"[data-tiddlywiki-droppable='yes']"
		);
	}

	function saveStyle(state,name) {
		state.originalStyles[name] = state.domNode.style[name];
	}

	function restoreStyles(state) {
		var domNode = state.domNode;

		Object.keys(state.originalStyles).forEach(function(name) {
			domNode.style[name] = state.originalStyles[name];
		});
	}

	function createPlaceholder(state) {
		var domNode = state.domNode,
			rect = domNode.getBoundingClientRect(),
			computedStyle = window.getComputedStyle(domNode),
			placeholder = options.widget.document.createElement("div");

		placeholder.style.boxSizing = computedStyle.boxSizing;
		placeholder.style.width = rect.width + "px";
		placeholder.style.height = rect.height + "px";
		placeholder.style.minWidth = computedStyle.minWidth;
		placeholder.style.minHeight = computedStyle.minHeight;
		placeholder.style.maxWidth = computedStyle.maxWidth;
		placeholder.style.maxHeight = computedStyle.maxHeight;
		placeholder.style.marginTop = computedStyle.marginTop;
		placeholder.style.marginRight = computedStyle.marginRight;
		placeholder.style.marginBottom = computedStyle.marginBottom;
		placeholder.style.marginLeft = computedStyle.marginLeft;
		placeholder.style.flex = computedStyle.flex;
		placeholder.style.flexBasis = computedStyle.flexBasis;
		placeholder.style.flexGrow = computedStyle.flexGrow;
		placeholder.style.flexShrink = computedStyle.flexShrink;
		placeholder.style.alignSelf = computedStyle.alignSelf;
		placeholder.style.gridColumn = computedStyle.gridColumn;
		placeholder.style.gridRow = computedStyle.gridRow;
		placeholder.style.gridColumnStart = computedStyle.gridColumnStart;
		placeholder.style.gridColumnEnd = computedStyle.gridColumnEnd;
		placeholder.style.gridRowStart = computedStyle.gridRowStart;
		placeholder.style.gridRowEnd = computedStyle.gridRowEnd;
		placeholder.style.visibility = "hidden";

		state.originalParent.insertBefore(
			placeholder,
			domNode
		);

		state.placeholder = placeholder;
	}

	function canStartDrag(state,event) {
		var dragTiddler = options.dragTiddlerFn &&
				options.dragTiddlerFn(),
			dragFilter = options.dragFilterFn &&
				options.dragFilterFn(),
			titles = dragTiddler ? [dragTiddler] : [];

		if(dragFilter) {
			titles.push.apply(
				titles,
				options.widget.wiki.filterTiddlers(
					dragFilter,
					options.widget
				)
			);
		}

		if(titles.length === 0) {
			return false;
		}

		if(options.selector) {
			return $tw.utils.domMatchesSelector(
				state.handleNode,
				options.selector
			);
		}

		return state.handleNode === domNode;
	}

	function startDrag(state,event) {
		var domNode = state.domNode,
			rect = domNode.getBoundingClientRect(),
			dragTiddler,
			dragFilter,
			titles,
			titleString,
			variables,
			startActions;

		dragTiddler = options.dragTiddlerFn &&
			options.dragTiddlerFn();

		dragFilter = options.dragFilterFn &&
			options.dragFilterFn();

		titles = dragTiddler ? [dragTiddler] : [];

		if(dragFilter) {
			titles.push.apply(
				titles,
				options.widget.wiki.filterTiddlers(
					dragFilter,
					options.widget
				)
			);
		}

		if(titles.length === 0) {
			return false;
		}

		titleString = $tw.utils.stringifyList(titles);

		state.dragging = true;
		state.originalParent = domNode.parentNode;
		state.originalNextSibling = domNode.nextSibling;
		state.offsetX = event.clientX - rect.left;
		state.offsetY = event.clientY - rect.top;
		state.width = rect.width;
		state.height = rect.height;
		state.originalStyles = Object.create(null);

		[
			"pointerEvents",
			"position",
			"left",
			"top",
			"width",
			"height"
		].forEach(function(name) {
			saveStyle(state,name);
		});

		createPlaceholder(state);

		domNode.setPointerCapture(event.pointerId);

		domNode.style.pointerEvents = "none";
		domNode.style.position = "fixed";
		domNode.style.left =
			(rect.left) + "px";
		domNode.style.top =
			(rect.top) + "px";
		domNode.style.width =
			(rect.width) + "px";
		domNode.style.height =
			(rect.height) + "px";

		options.widget.document.body.appendChild(domNode);

		$tw.utils.addClass(domNode,"tc-dragging");

		$tw.dragInProgress = domNode;

		dispatchSyntheticEvent(
			domNode,
			"dragstart",
			event
		);

		startActions = options.startActions;

		if(startActions !== undefined) {
			variables = $tw.utils.collectDOMVariables(
				domNode,
				null,
				event
			);

			variables.modifier =
				$tw.keyboardManager.getEventModifierKeyDescriptor(
					event
				);

			variables["actionTiddler"] = titleString;

			options.widget.invokeActionString(
				startActions,
				options.widget,
				event,
				variables
			);
		}

		state.currentDroppable = getDroppableTarget(event);

		if(state.currentDroppable) {
			dispatchSyntheticEvent(
				state.currentDroppable,
				"dragenter",
				event
			);

			dispatchSyntheticEvent(
				state.currentDroppable,
				"dragover",
				event
			);
		}

		return true;
	}

	function updateDrag(state,event) {
		var domNode = state.domNode,
			droppableTarget;

		domNode.style.left =
			(event.clientX - state.offsetX) + "px";

		domNode.style.top =
			(event.clientY - state.offsetY) + "px";

		droppableTarget = getDroppableTarget(event);

		if(droppableTarget !== state.currentDroppable) {
			if(state.currentDroppable) {
				dispatchSyntheticEvent(
					state.currentDroppable,
					"dragleave",
					event
				);
			}

			if(droppableTarget) {
				dispatchSyntheticEvent(
					droppableTarget,
					"dragenter",
					event
				);
			}

			state.currentDroppable = droppableTarget;
		}

		if(state.currentDroppable) {
			dispatchSyntheticEvent(
				state.currentDroppable,
				"dragover",
				event
			);
		}
	}

	function removePlaceholder(state) {
		if(
			state.placeholder &&
			state.placeholder.parentNode
		) {
			state.placeholder.parentNode.removeChild(
				state.placeholder
			);
		}

		state.placeholder = null;
	}

	function releasePointer(state,event) {
		if(
			state.domNode.hasPointerCapture &&
			state.domNode.hasPointerCapture(event.pointerId)
		) {
			state.domNode.releasePointerCapture(
				event.pointerId
			);
		}
	}

	function cleanupDragState(state,event) {
		var domNode = state.domNode;

		removePlaceholder(state);

		restoreStyles(state);

		$tw.utils.removeClass(
			domNode,
			"tc-dragging"
		);

		releasePointer(state,event);

		if($tw.dragInProgress === domNode) {
			$tw.dragInProgress = null;
		}

		delete dragStates[state.pointerId];
	}

	function finishDrag(state,event) {
		var domNode = state.domNode,
			dropTarget = state.currentDroppable,
			dragTiddler,
			dragFilter,
			titles,
			titleString,
			variables,
			endActions;

		if(dropTarget) {
			dispatchSyntheticEvent(
				dropTarget,
				"drop",
				event
			);
		}

		dispatchSyntheticEvent(
			domNode,
			"dragend",
			event
		);

		dragTiddler = options.dragTiddlerFn &&
			options.dragTiddlerFn();

		dragFilter = options.dragFilterFn &&
			options.dragFilterFn();

		titles = dragTiddler ? [dragTiddler] : [];

		if(dragFilter) {
			titles.push.apply(
				titles,
				options.widget.wiki.filterTiddlers(
					dragFilter,
					options.widget
				)
			);
		}

		titleString = $tw.utils.stringifyList(titles);
		endActions = options.endActions;

		if(endActions !== undefined) {
			variables = $tw.utils.collectDOMVariables(
				domNode,
				null,
				event
			);

			variables.modifier =
				$tw.keyboardManager.getEventModifierKeyDescriptor(
					event
				);

			variables["actionTiddler"] = titleString;

			options.widget.invokeActionString(
				endActions,
				options.widget,
				event,
				variables
			);
		}

		if(domNode.parentNode === options.widget.document.body) {
			if(
				state.placeholder &&
				state.placeholder.parentNode === state.originalParent
			) {
				state.originalParent.insertBefore(
					domNode,
					state.placeholder
				);
			} else if(state.originalParent) {
				state.originalParent.appendChild(domNode);
			}
		}

		cleanupDragState(state,event);
	}

	function cancelDrag(state,event) {
		var domNode = state.domNode;

		if(state.currentDroppable) {
			dispatchSyntheticEvent(
				state.currentDroppable,
				"dragleave",
				event
			);
		}

		dispatchSyntheticEvent(
			domNode,
			"dragend",
			event
		);

		cleanupDragState(state,event);
	}

	$tw.utils.addEventListeners(domNode,[
		{
			name: "pointerdown",
			handlerFunction: function(event) {
				var pointerId = event.pointerId;

				if(
					event.pointerType === "mouse" &&
					event.button !== 0
				) {
					return;
				}

				if(options.selector) {
					if(
						!$tw.utils.domMatchesSelector(
							event.target,
							options.selector
						)
					) {
						return;
					}
				} else if(event.target !== domNode) {
					return;
				}

				if(dragStates[pointerId]) {
					return;
				}

				dragStates[pointerId] = {
					pointerId: pointerId,
					domNode: domNode,
					handleNode: event.target,
					dragging: false,
					currentDroppable: null,
					originalParent: null,
					originalNextSibling: null,
					placeholder: null,
					offsetX: 0,
					offsetY: 0,
					startX: event.clientX,
					startY: event.clientY,
					originalStyles: null
				};

				domNode.setPointerCapture(pointerId);
			}
		},
		{
			name: "pointermove",
			handlerFunction: function(event) {
				var state = dragStates[event.pointerId];

				if(!state) {
					return;
				}

				if(!state.dragging) {
					if(
						Math.abs(
							event.clientX - state.startX
						) < dragThreshold &&
						Math.abs(
							event.clientY - state.startY
						) < dragThreshold
					) {
						return;
					}

					if(!canStartDrag(state,event)) {
						delete dragStates[event.pointerId];

						releasePointer(state,event);

						return;
					}

					if(!startDrag(state,event)) {
						delete dragStates[event.pointerId];

						releasePointer(state,event);

						return;
					}
				} else {
					updateDrag(state,event);
				}
			}
		},
		{
			name: "pointerup",
			handlerFunction: function(event) {
				var state = dragStates[event.pointerId];

				if(!state) {
					return;
				}

				if(state.dragging) {
					finishDrag(state,event);
				} else {
					releasePointer(state,event);
					delete dragStates[event.pointerId];
				}
			}
		},
		{
			name: "pointercancel",
			handlerFunction: function(event) {
				var state = dragStates[event.pointerId];

				if(!state) {
					return;
				}

				if(state.dragging) {
					cancelDrag(state,event);
				} else {
					releasePointer(state,event);
					delete dragStates[event.pointerId];
				}
			}
		},
		{
			name: "lostpointercapture",
			handlerFunction: function(event) {
				var state = dragStates[event.pointerId];

				if(!state) {
					return;
				}

				if(state.dragging) {
					cancelDrag(state,event);
				} else {
					delete dragStates[event.pointerId];
				}
			}
		}
	]);
};

exports.importDataTransfer = function(dataTransfer,fallbackTitle,callback) {
	if($tw.log.IMPORT) {
		console.log("Available data types:");
		for(var type=0; type<dataTransfer.types.length; type++) {
			console.log(
				"type",
				type,
				dataTransfer.types[type],
				dataTransfer.getData(dataTransfer.types[type])
			);
		}
	}

	for(var t=0; t<importDataTypes.length; t++) {
		if(!$tw.browser.isIE || importDataTypes[t].IECompatible) {
			var dataType = importDataTypes[t],
				data = dataTransfer.getData(dataType.type);

			if(data !== "" && data !== null) {
				if($tw.log.IMPORT) {
					console.log(
						"Importing data type '" +
						dataType.type +
						"', data: '" +
						data +
						"'"
					);
				}

				var tiddlerFields =
					dataType.toTiddlerFieldsArray(
						data,
						fallbackTitle
					);

				callback(tiddlerFields);
				return;
			}
		}
	}
};

exports.importPaste = function(item,fallbackTitle,callback) {
	for(var t=0; t<importDataTypes.length; t++) {
		if(item.type === importDataTypes[t].type) {
			var dataType = importDataTypes[t];

			item.getAsString(function(data) {
				if($tw.log.IMPORT) {
					console.log(
						"Importing data type '" +
						dataType.type +
						"', data: '" +
						data +
						"'"
					);
				}

				var tiddlerFields =
					dataType.toTiddlerFieldsArray(
						data,
						fallbackTitle
					);

				callback(tiddlerFields);
			});

			return;
		}
	}
};

exports.itemHasValidDataType = function(item) {
	for(var t=0; t<importDataTypes.length; t++) {
		if(!$tw.browser.isIE || importDataTypes[t].IECompatible) {
			if(item.type === importDataTypes[t].type) {
				return true;
			}
		}
	}

	return false;
};

var importDataTypes = [
	{
		type: "text/vnd.tiddler",
		IECompatible: false,
		toTiddlerFieldsArray: function(data,fallbackTitle) {
			return parseJSONTiddlers(data,fallbackTitle);
		}
	},
	{
		type: "URL",
		IECompatible: true,
		toTiddlerFieldsArray: function(data,fallbackTitle) {
			var match =
				$tw.utils.decodeURIComponentSafe(data).match(
					/^data\:text\/vnd\.tiddler,(.*)/i
				);

			if(match) {
				return parseJSONTiddlers(
					match[1],
					fallbackTitle
				);
			} else {
				return [{
					title: fallbackTitle,
					text: data
				}];
			}
		}
	},
	{
		type: "text/x-moz-url",
		IECompatible: false,
		toTiddlerFieldsArray: function(data,fallbackTitle) {
			var match =
				$tw.utils.decodeURIComponentSafe(data).match(
					/^data\:text\/vnd\.tiddler,(.*)/i
				);

			if(match) {
				return parseJSONTiddlers(
					match[1],
					fallbackTitle
				);
			} else {
				return [{
					title: fallbackTitle,
					text: data
				}];
			}
		}
	},
	{
		type: "text/html",
		IECompatible: false,
		toTiddlerFieldsArray: function(data,fallbackTitle) {
			return [{
				title: fallbackTitle,
				text: data
			}];
		}
	},
	{
		type: "text/plain",
		IECompatible: false,
		toTiddlerFieldsArray: function(data,fallbackTitle) {
			return [{
				title: fallbackTitle,
				text: data
			}];
		}
	},
	{
		type: "Text",
		IECompatible: true,
		toTiddlerFieldsArray: function(data,fallbackTitle) {
			return [{
				title: fallbackTitle,
				text: data
			}];
		}
	},
	{
		type: "text/uri-list",
		IECompatible: false,
		toTiddlerFieldsArray: function(data,fallbackTitle) {
			var match =
				$tw.utils.decodeURIComponentSafe(data).match(
					/^data\:text\/vnd\.tiddler,(.*)/i
				);

			if(match) {
				return parseJSONTiddlers(
					match[1],
					fallbackTitle
				);
			} else {
				return [{
					title: fallbackTitle,
					text: data
				}];
			}
		}
	}
];

function parseJSONTiddlers(json,fallbackTitle) {
	var data = $tw.utils.parseJSONSafe(json);

	if(!$tw.utils.isArray(data)) {
		data = [data];
	}

	data.forEach(function(fields) {
		fields.title = fields.title || fallbackTitle;
	});

	return data;
}

function dragEventContainsType(event,targetType) {
	if(event.dataTransfer.types) {
		for(var i=0; i<event.dataTransfer.types.length; i++) {
			if(event.dataTransfer.types[i] === targetType) {
				return true;
			}
		}
	}

	return false;
}

exports.dragEventContainsFiles = function(event) {
	return (
		dragEventContainsType(event,"Files") &&
		!dragEventContainsType(event,"text/plain")
	);
};

exports.dragEventContainsType = dragEventContainsType;
