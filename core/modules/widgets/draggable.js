/*\
title: $:/core/modules/widgets/draggable.js
type: application/javascript
module-type: widget

Draggable widget

\*/

"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var DraggableWidget = function(parseTreeNode,options) {
	this.initialise(parseTreeNode,options);
	/*
	Per-pointer drag state.

	Each active pointer gets its own state object, keyed by pointerId.
	This allows multiple simultaneous touch/pen drags.
	*/
	this.dragStates = Object.create(null);
};

DraggableWidget.prototype = new Widget();

DraggableWidget.prototype.render = function(parent,nextSibling) {
	var self = this,
		tag,
		domNode,
		classes = [];

	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();
	tag = this.draggableTag;
	if($tw.config.htmlUnsafeElements.indexOf(tag) !== -1) {
		tag = "div";
	}
	domNode = this.document.createElement(tag);
	if(this.draggableClasses) {
		classes.push(this.draggableClasses);
	}
	if(!this.dragHandleSelector && this.dragEnable) {
		classes.push("tc-draggable");
	}
	domNode.setAttribute("class",classes.join(" "));

	/*
	Mark the DOM node as a TiddlyWiki draggable.

	This gives the synthetic drag implementation a reliable way of
	identifying the actual draggable DOM node.
	*/
	domNode.setAttribute("data-tiddlywiki-draggable","yes");
	this.assignAttributes(domNode,{
		sourcePrefix: "data-",
		destPrefix: "data-"
	});
	parent.insertBefore(domNode,nextSibling);
	this.domNodes.push(domNode);
	this.renderChildren(domNode,null);

	if(this.dragEnable) {
		$tw.utils.makeDraggable({
			domNode: domNode,
			dragTiddlerFn: function() {
				return self.getAttribute("tiddler");
			},
			dragFilterFn: function() {
				return self.getAttribute("filter");
			},
			startActions: self.startActions,
			endActions: self.endActions,
			dragImageType: self.dragImageType,
			widget: self,
			selector: self.dragHandleSelector,

			/*
			The widget owns the per-pointer state.

			makeDraggable should use dragStates[event.pointerId]
			instead of maintaining a single global drag state.
			*/
			dragStates: self.dragStates
		});
	}
};

DraggableWidget.prototype.execute = function() {
	/*
	Pick up our attributes
	*/
	this.draggableTag = this.getAttribute("tag","div");
	this.draggableClasses = this.getAttribute("class");
	this.startActions = this.getAttribute("startactions");
	this.endActions = this.getAttribute("endactions");
	this.dragImageType = this.getAttribute("dragimagetype");
	this.dragHandleSelector = this.getAttribute("selector");
	this.dragEnable = this.getAttribute("enable","yes") === "yes";
	this.makeChildWidgets();
};

DraggableWidget.prototype.updateDomNodeClasses = function() {
	var domNodeClasses = this.domNodes[0].className.split(" "),
		oldClasses = this.draggableClasses.split(" ");

	this.draggableClasses = this.getAttribute("class");
	$tw.utils.each(oldClasses,function(oldClass) {
		var i = domNodeClasses.indexOf(oldClass);

		if(i !== -1) {
			domNodeClasses.splice(i,1);
		}
	});
	$tw.utils.pushTop(domNodeClasses,this.draggableClasses);
	this.domNodes[0].setAttribute(
		"class",
		domNodeClasses.join(" ")
	);
};

DraggableWidget.prototype.refresh = function(changedTiddlers) {
	var changedAttributes = this.computeAttributes();

	if(
		changedAttributes.tag ||
		changedAttributes.selector ||
		changedAttributes.dragimagetype ||
		changedAttributes.enable ||
		changedAttributes.startactions ||
		changedAttributes.endactions
	) {
		this.refreshSelf();
		return true;
	} else {
		if(changedAttributes["class"]) {
			this.updateDomNodeClasses();
		}

		this.assignAttributes(this.domNodes[0],{
			changedAttributes: changedAttributes,
			sourcePrefix: "data-",
			destPrefix: "data-"
		});
	}

	return this.refreshChildren(changedTiddlers);
};


/*
Clean up active pointer states.

The actual pointer cancellation/DOM restoration is handled by
makeDraggable, but the widget must not retain references to states
after it has been removed.
*/
DraggableWidget.prototype.removeChildDomNodes = function() {
	this.dragStates = Object.create(null);
	Widget.prototype.removeChildDomNodes.call(this);
};


exports.draggable = DraggableWidget;
