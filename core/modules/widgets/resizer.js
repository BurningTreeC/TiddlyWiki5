/*\
title: $:/core/modules/widgets/resizer.js
type: application/javascript
module-type: widget

Resizer widget for resizing elements

\*/

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var ResizerWidget = function(parseTreeNode,options) {
	this.initialise(parseTreeNode,options);
};

/*
Inherit from the base widget class
*/
ResizerWidget.prototype = new Widget();

/*
Render this widget into the DOM
*/
ResizerWidget.prototype.render = function(parent,nextSibling) {
	// Save the parent dom node
	this.parentDomNode = parent;
	// Compute our attributes
	this.computeAttributes();
	// Execute our logic
	this.execute();
	// Create our element
	var domNode = this.document.createElement("div");
	domNode.className = "tc-resizer " + (this.resizerClass || "");
	domNode.setAttribute("data-direction", this.direction);
	// Add event handlers
	this.addEventHandlers(domNode);
	// Insert element
	parent.insertBefore(domNode,nextSibling);
	this.renderChildren(domNode,null);
	this.domNodes.push(domNode);
};

/*
Add event handlers to the resizer
*/
ResizerWidget.prototype.addEventHandlers = function(domNode) {
	var self = this;
	var isResizing = false;
	var startX = 0;
	var startY = 0;
	var startValue = 0;
	var targetElement = null;
	var initialMouseX = 0;
	var initialMouseY = 0;
	var parentSizeAtStart = 0;
	
	// Helper to get numeric value from a string with units
	var getNumericValue = function(value) {
		return parseFloat(value) || 0;
	};
	
	// Helper to update the tiddler value
	var updateValue = function(newValue) {
		if(self.targetTiddler) {
			// Ensure minimum and maximum values
			// For percentage units, min/max are also percentages
			var effectiveMin = self.minValue;
			var effectiveMax = self.maxValue;
			
			if(effectiveMin !== null && newValue < effectiveMin) {
				newValue = effectiveMin;
			}
			if(effectiveMax !== null && newValue > effectiveMax) {
				newValue = effectiveMax;
			}
			// Format the value based on the unit type
			var formattedValue;
			if(self.unit === "%") {
				// For percentages, round to 1 decimal place
				formattedValue = newValue.toFixed(1) + "%";
			} else {
				// For pixels, round to integer
				formattedValue = Math.round(newValue) + (self.unit || "px");
			}
			// Update the tiddler
			self.wiki.setText(self.targetTiddler, self.targetField || "text", null, formattedValue);
		}
		// Call action string if provided
		if(self.actions) {
			var formattedValue;
			if(self.unit === "%") {
				formattedValue = newValue.toFixed(1) + "%";
			} else {
				formattedValue = Math.round(newValue) + (self.unit || "px");
			}
			self.invokeActionString(self.actions, self, {value: newValue, formattedValue: formattedValue});
		}
	};
	
	var handlePointerDown = function(event) {
		event.preventDefault();
		isResizing = true;
		
		// Store the actual initial mouse position
		initialMouseX = event.clientX;
		initialMouseY = event.clientY;
		
		// For now, use simple start position without offset adjustment
		startX = event.clientX;
		startY = event.clientY;
		
		// Get the current value
		if(self.targetTiddler) {
			var tiddler = self.wiki.getTiddler(self.targetTiddler);
			var currentValue;
			if(tiddler && self.targetField && self.targetField !== "text") {
				currentValue = tiddler.fields[self.targetField] || self.defaultValue || "200px";
			} else {
				currentValue = self.wiki.getTiddlerText(self.targetTiddler, self.defaultValue || "200px");
			}
			startValue = getNumericValue(currentValue);
		} else {
			startValue = getNumericValue(self.defaultValue || "200px");
		}
		
		// Cache the parent size at the start of drag for percentage calculations
		if(self.unit === "%") {
			var parentElement = domNode.parentElement;
			if(parentElement) {
				// Use offset dimensions for relative positioning, getBoundingClientRect for absolute
				if(self.position === "relative") {
					parentSizeAtStart = self.direction === "horizontal" ? parentElement.offsetWidth : parentElement.offsetHeight;
				} else {
					var parentRect = parentElement.getBoundingClientRect();
					parentSizeAtStart = self.direction === "horizontal" ? parentRect.width : parentRect.height;
				}
				console.log("Parent size at start:", parentSizeAtStart);
			}
		}
		
		// Find the target element to resize
		if(self.targetSelector) {
			targetElement = self.document.querySelector(self.targetSelector);
		} else if(self.targetElement === "parent") {
			targetElement = domNode.parentElement;
		} else if(self.targetElement === "previousSibling") {
			targetElement = domNode.previousElementSibling;
		} else if(self.targetElement === "nextSibling") {
			targetElement = domNode.nextElementSibling;
		}
		
		// Add active class
		domNode.classList.add("tc-resizer-active");
		
		// Add resizing class to body to disable transitions
		self.document.body.classList.add("tc-resizing");
		
		// Find the existing overlay in the DOM
		var overlay = self.document.querySelector(".tc-gridtemplate-resize-overlay");
		if(!overlay) {
			// If overlay doesn't exist, create it and insert as first child
			overlay = self.document.createElement("div");
			overlay.className = "tc-gridtemplate-resize-overlay";
			self.document.body.insertBefore(overlay, self.document.body.firstChild);
		}
		
		// Set the cursor for this resize operation
		overlay.style.cursor = self.direction === "horizontal" ? "ew-resize" : "ns-resize";
		
		// Add pointermove handler to overlay
		overlay.addEventListener("pointermove", handlePointerMove);
		overlay.addEventListener("pointerup", handlePointerUp);
		
		self.overlay = overlay;
		
		// Store pointer ID for capture
		self.pointerId = event.pointerId;
		
		// Capture pointer events to the overlay
		overlay.setPointerCapture(event.pointerId);
		
		// Prevent text selection
		self.document.body.style.userSelect = "none";
	};
	
	var handlePointerMove = function(event) {
		if(!isResizing) return;
		
		var deltaX = event.clientX - startX;
		var deltaY = event.clientY - startY;
		var newValue;
		
		// For percentage units, we need to calculate relative to parent
		if(self.unit === "%") {
			// Use the cached parent size from drag start
			if(parentSizeAtStart > 0) {
				// Calculate the current size in pixels based on the start percentage
				var currentSizeInPixels = (startValue / 100) * parentSizeAtStart;
				
				// Get the mouse delta
				var delta = self.direction === "horizontal" ? deltaX : deltaY;
				
				// Calculate the new size in pixels
				var newSizeInPixels;
				if(self.invertDirection === "yes") {
					newSizeInPixels = currentSizeInPixels - delta;
				} else {
					newSizeInPixels = currentSizeInPixels + delta;
				}
				
				// Convert the pixel size back to percentage of the parent container
				newValue = (newSizeInPixels / parentSizeAtStart) * 100;
				
				console.log("Current size (px):", currentSizeInPixels, "New size (px):", newSizeInPixels, "New value (%):", newValue);
			}
		} else {
			// For pixel units
			if(self.direction === "horizontal") {
				// For horizontal resizing
				if(self.invertDirection === "yes") {
					newValue = startValue - deltaX;
				} else {
					newValue = startValue + deltaX;
				}
			} else {
				// For vertical resizing
				if(self.invertDirection === "yes") {
					newValue = startValue - deltaY;
				} else {
					newValue = startValue + deltaY;
				}
			}
		}
		
		// Update the value
		updateValue(newValue);
		
		// Optionally update the target element directly for immediate feedback
		if(targetElement && self.liveResize === "yes") {
			if(self.direction === "horizontal") {
				targetElement.style.width = newValue + (self.unit || "px");
			} else {
				targetElement.style.height = newValue + (self.unit || "px");
			}
		}
	};
	
	var handlePointerUp = function(event) {
		if(!isResizing) return;
		
		isResizing = false;
		domNode.classList.remove("tc-resizer-active");
		
		// Remove resizing class from body
		self.document.body.classList.remove("tc-resizing");
		
		// Clean up overlay
		if(self.overlay) {
			// Release pointer capture if we have it
			if(self.pointerId !== undefined) {
				try {
					self.overlay.releasePointerCapture(self.pointerId);
				} catch(e) {
					// Pointer might already be released
				}
			}
			// Remove event listeners
			self.overlay.removeEventListener("pointermove", handlePointerMove);
			self.overlay.removeEventListener("pointerup", handlePointerUp);
			// Reset cursor
			self.overlay.style.cursor = "";
			self.overlay = null;
		}
		
		// Restore cursor and selection
		self.document.body.style.userSelect = "";
	};
	
	// Add pointer event listener (works for both mouse and touch)
	domNode.addEventListener("pointerdown", handlePointerDown);
};

/*
Compute the internal state of the widget
*/
ResizerWidget.prototype.execute = function() {
	// Get our parameters
	this.direction = this.getAttribute("direction", "horizontal"); // horizontal or vertical
	this.targetTiddler = this.getAttribute("tiddler");
	this.targetField = this.getAttribute("field", "text");
	this.targetSelector = this.getAttribute("selector");
	this.targetElement = this.getAttribute("element"); // parent, previousSibling, nextSibling
	this.unit = this.getAttribute("unit", "px");
	this.position = this.getAttribute("position", "absolute"); // absolute or relative
	this.defaultValue = this.getAttribute("default", this.unit === "%" ? "50%" : "200px");
	// Parse min/max values - defaults depend on unit type
	var minDefault = this.unit === "%" ? "10" : "50";
	var maxDefault = this.unit === "%" ? "90" : "800";
	this.minValue = this.getAttribute("min") ? parseFloat(this.getAttribute("min")) : parseFloat(minDefault);
	this.maxValue = this.getAttribute("max") ? parseFloat(this.getAttribute("max")) : parseFloat(maxDefault);
	this.invertDirection = this.getAttribute("invert", "no");
	this.liveResize = this.getAttribute("live", "no");
	this.resizerClass = this.getAttribute("class", "");
	this.actions = this.getAttribute("actions");
	// Make child widgets
	this.makeChildWidgets();
};

/*
Selectively refreshes the widget if needed. Returns true if the widget or any of its children needed re-rendering
*/
ResizerWidget.prototype.refresh = function(changedTiddlers) {
	var changedAttributes = this.computeAttributes();
	if(Object.keys(changedAttributes).length) {
		this.refreshSelf();
		return true;
	}
	return this.refreshChildren(changedTiddlers);
};

exports.resizer = ResizerWidget;
