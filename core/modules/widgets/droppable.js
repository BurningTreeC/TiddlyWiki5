/*\
title: $:/core/modules/widgets/droppable.js
type: application/javascript
module-type: widget

Droppable widget

\*/

"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var DroppableWidget = function(parseTreeNode,options) {
	this.initialise(parseTreeNode,options);
};

/*
Inherit from the base widget class
*/
DroppableWidget.prototype = new Widget();

/*
Render this widget into the DOM
*/
DroppableWidget.prototype.render = function(parent,nextSibling) {
	var tag = this.parseTreeNode.isBlock ? "div" : "span",
		domNode;

	// Remember parent
	this.parentDomNode = parent;

	// Compute attributes and execute state
	this.computeAttributes();
	this.execute();

	if(this.droppableTag && $tw.config.htmlUnsafeElements.indexOf(this.droppableTag) === -1) {
		tag = this.droppableTag;
	}

	// Create element and assign classes
	domNode = this.document.createElement(tag);
	this.domNode = domNode;
	this.assignDomNodeClasses();

	/*
	Mark this element as a TiddlyWiki droppable.

	This marker is used by the synthetic drag/drop implementation to
	identify actual droppable DOM nodes independently of their CSS class.
	*/
	domNode.setAttribute("data-tiddlywiki-droppable","yes");

	// Assign data- attributes and style. attributes
	this.assignAttributes(domNode,{
		sourcePrefix: "data-",
		destPrefix: "data-"
	});

	// Add event handlers
	if(this.droppableEnable) {
		$tw.utils.addEventListeners(domNode,[
			{name: "dragenter", handlerObject: this, handlerMethod: "handleDragEnterEvent"},
			{name: "dragover", handlerObject: this, handlerMethod: "handleDragOverEvent"},
			{name: "dragleave", handlerObject: this, handlerMethod: "handleDragLeaveEvent"},
			{name: "drop", handlerObject: this, handlerMethod: "handleDropEvent"}
		]);
	} else {
		$tw.utils.addClass(this.domNode,this.disabledClass);
	}

	// Insert element
	parent.insertBefore(domNode,nextSibling);
	this.domNodes.push(domNode);

	this.renderChildren(domNode,null);

	// Stack of outstanding enter/leave events
	this.currentlyEntered = [];
};

DroppableWidget.prototype.enterDrag = function(event) {
	var target = event.target || this.domNodes[0];

	if(this.currentlyEntered.indexOf(target) === -1) {
		this.currentlyEntered.push(target);
	}

	// If we're entering for the first time we need to apply highlighting
	$tw.utils.addClass(this.domNodes[0],"tc-dragover");
};

DroppableWidget.prototype.leaveDrag = function(event) {
	var target = event.target || this.domNodes[0],
		pos = this.currentlyEntered.indexOf(target);

	if(pos !== -1) {
		this.currentlyEntered.splice(pos,1);
	}

	/*
	Remove highlighting if we're leaving externally.

	The second condition resolves a Firefox problem whereby there is
	an erroneous dragenter event if the node being dragged is within
	the dropzone.

	This also remains compatible with synthetic drag events because
	$tw.dragInProgress identifies the element currently being dragged.
	*/
	if(this.currentlyEntered.length === 0 ||
		(this.currentlyEntered.length === 1 && this.currentlyEntered[0] === $tw.dragInProgress)) {

		this.currentlyEntered = [];

		if(this.domNodes[0]) {
			$tw.utils.removeClass(this.domNodes[0],"tc-dragover");
		}
	}
};

DroppableWidget.prototype.handleDragEnterEvent = function(event) {
	this.enterDrag(event);

	/*
	Tell the browser that we're ready to handle the drop.

	This also applies to synthetic dragenter events.
	*/
	event.preventDefault();

	/*
	Do not allow the event to ripple up to parent droppable widgets.
	*/
	event.stopPropagation();

	return false;
};

DroppableWidget.prototype.handleDragOverEvent = function(event) {
	var target = event.target || this.domNodes[0];

	// Check for being over a TEXTAREA or INPUT
	if(target.tagName && ["TEXTAREA","INPUT"].indexOf(target.tagName) !== -1) {
		return false;
	}

	/*
	Tell the browser that we're still interested in the drop.
	This is also required for synthetic dragover events so that the
	droppable behaves identically to a native HTML5 drop target.
	*/
	event.preventDefault();

	// Set the drop effect
	if(event.dataTransfer) {
		event.dataTransfer.dropEffect = this.droppableEffect;
	}

	return false;
};

DroppableWidget.prototype.handleDragLeaveEvent = function(event) {
	this.leaveDrag(event);
	return false;
};

DroppableWidget.prototype.handleDropEvent = function(event) {
	var self = this,
		target = event.target || this.domNodes[0];

	this.leaveDrag(event);

	// Check for being over a TEXTAREA or INPUT
	if(target.tagName && ["TEXTAREA","INPUT"].indexOf(target.tagName) !== -1) {
		return false;
	}

	var dataTransfer = event.dataTransfer;

	// Remove highlighting
	if(this.domNodes[0]) {
		$tw.utils.removeClass(this.domNodes[0],"tc-dragover");
	}

	// Try to import the various data types we understand
	if(this.droppableActions && dataTransfer) {
		$tw.utils.importDataTransfer(dataTransfer,null,function(fieldsArray) {
			fieldsArray.forEach(function(fields) {
				self.performActions(fields.title || fields.text,event);
			});
		});
	}

	// Send a TitleList to performListActions
	if(this.droppableListActions && dataTransfer) {
		$tw.utils.importDataTransfer(dataTransfer,null,function(fieldsArray) {
			var titleList = [];

			fieldsArray.forEach(function(fields) {
				titleList.push(fields.title || fields.text);
			});

			self.performListActions(
				$tw.utils.stringifyList(titleList),
				event
			);
		});
	}

	/*
	Tell the browser that we handled the drop.
	*/
	event.preventDefault();

	/*
	Stop the drop from rippling up to parent droppable widgets.
	*/
	event.stopPropagation();

	return false;
};

DroppableWidget.prototype.performListActions = function(titleList,event) {
	if(this.droppableListActions) {
		var modifierKey = $tw.keyboardManager.getEventModifierKeyDescriptor(event);

		this.invokeActionString(
			this.droppableListActions,
			this,
			event,
			{
				actionTiddlerList: titleList,
				modifier: modifierKey
			}
		);
	}
};

DroppableWidget.prototype.performActions = function(title,event) {
	if(this.droppableActions) {
		var modifierKey = $tw.keyboardManager.getEventModifierKeyDescriptor(event);

		this.invokeActionString(
			this.droppableActions,
			this,
			event,
			{
				actionTiddler: title,
				modifier: modifierKey
			}
		);
	}
};

/*
Compute the internal state of the widget
*/
DroppableWidget.prototype.execute = function() {
	this.droppableActions = this.getAttribute("actions");
	this.droppableListActions = this.getAttribute("listActions");
	this.droppableEffect = this.getAttribute("effect","copy");
	this.droppableTag = this.getAttribute("tag");
	this.droppableEnable = (this.getAttribute("enable") || "yes") === "yes";
	this.disabledClass = this.getAttribute("disabledClass","");

	// Make child widgets
	this.makeChildWidgets();
};

DroppableWidget.prototype.assignDomNodeClasses = function() {
	var classes = this.getAttribute("class","").split(" ");

	classes.push("tc-droppable");

	this.domNode.className = classes.join(" ").trim();
};

/*
Selectively refreshes the widget if needed. Returns true if the widget or any of its children needed re-rendering
*/
DroppableWidget.prototype.refresh = function(changedTiddlers) {
	var changedAttributes = this.computeAttributes();

	if(changedAttributes.tag ||
		changedAttributes.enable ||
		changedAttributes.disabledClass ||
		changedAttributes.actions ||
		changedAttributes.listActions ||
		changedAttributes.effect) {

		this.refreshSelf();
		return true;

	} else {
		if(changedAttributes["class"]) {
			this.assignDomNodeClasses();
		}

		this.assignAttributes(this.domNodes[0],{
			changedAttributes: changedAttributes,
			sourcePrefix: "data-",
			destPrefix: "data-"
		});
	}

	return this.refreshChildren(changedTiddlers);
};

exports.droppable = DroppableWidget;
