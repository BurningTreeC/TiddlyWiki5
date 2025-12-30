/*\
title: $:/plugins/tiddlywiki/editor/line-block/line-block.js
type: application/javascript
module-type: editor-plugin

Line/block operations: duplicate, delete, move lines up/down.

Plugin Metadata:
- name: line-block
- configTiddler: $:/config/Editor/EnableLineBlock
- defaultEnabled: true

\*/
"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "line-block";
exports.configTiddler = "$:/config/Editor/EnableLineBlock";
exports.defaultEnabled = true;
exports.description = "Line/block operations: duplicate, delete, move lines up/down";
exports.category = "editing";

// ==================== PLUGIN IMPLEMENTATION ====================
exports.create = function(engine) { return new LineBlockPlugin(engine); };

function LineBlockPlugin(engine) {
	this.engine = engine;
	this.name = "line-block";
	this.enabled = false;

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this)
	};
}

LineBlockPlugin.prototype.enable = function() { this.enabled = true; };
LineBlockPlugin.prototype.disable = function() { this.enabled = false; };

LineBlockPlugin.prototype.onKeydown = function(event) {
	if(!this.enabled) return;
	var ta = this.engine.domNode;
	if(!ta) return;

	var ctrl = event.ctrlKey || event.metaKey;

	// Duplicate
	if(ctrl && event.shiftKey && (event.key === "D" || event.key === "d")) {
		event.preventDefault();
		this.duplicateSelectionOrLines();
		return false;
	}

	// Delete line
	if(ctrl && event.shiftKey && (event.key === "K" || event.key === "k")) {
		event.preventDefault();
		this.deleteSelectionOrLines();
		return false;
	}

	// Move line/selection
	if(event.altKey && !ctrl && !event.shiftKey) {
		if(event.key === "ArrowUp") {
			event.preventDefault();
			this.moveSelectionOrLines(-1);
			return false;
		}
		if(event.key === "ArrowDown") {
			event.preventDefault();
			this.moveSelectionOrLines(1);
			return false;
		}
	}
};

LineBlockPlugin.prototype.getLineRangeForSelection = function(text, selStart, selEnd) {
	// Expand to full lines intersecting selection; include trailing newline if present.
	var startLineStart = text.lastIndexOf("\n", selStart - 1) + 1;
	var endLineEnd = text.indexOf("\n", selEnd);
	if(endLineEnd === -1) endLineEnd = text.length;
	else endLineEnd = endLineEnd + 1; // include newline
	return { start: startLineStart, end: endLineEnd };
};

LineBlockPlugin.prototype.duplicateSelectionOrLines = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;

	var s = ta.selectionStart, e = ta.selectionEnd;
	engine.captureBeforeState && engine.captureBeforeState();

	if(s !== e) {
		var chunk = text.slice(s, e);
		ta.value = text.slice(0, e) + chunk + text.slice(e);
		ta.selectionStart = e;
		ta.selectionEnd = e + chunk.length;
	} else {
		var lr = this.getLineRangeForSelection(text, s, e);
		var lines = text.slice(lr.start, lr.end);
		ta.value = text.slice(0, lr.end) + lines + text.slice(lr.end);
		ta.selectionStart = lr.end;
		ta.selectionEnd = lr.end + lines.length;
	}

	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

LineBlockPlugin.prototype.deleteSelectionOrLines = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;

	var s = ta.selectionStart, e = ta.selectionEnd;
	engine.captureBeforeState && engine.captureBeforeState();

	var cutStart, cutEnd;
	if(s !== e) {
		cutStart = s; cutEnd = e;
	} else {
		var lr = this.getLineRangeForSelection(text, s, e);
		cutStart = lr.start; cutEnd = lr.end;
	}
	ta.value = text.slice(0, cutStart) + text.slice(cutEnd);
	ta.selectionStart = cutStart;
	ta.selectionEnd = cutStart;

	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

LineBlockPlugin.prototype.moveSelectionOrLines = function(direction) {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var s = ta.selectionStart, e = ta.selectionEnd;

	var lr = this.getLineRangeForSelection(text, s, e);
	var block = text.slice(lr.start, lr.end);

	// Find adjacent line range to swap with
	if(direction < 0) {
		if(lr.start === 0) return;
		var prevStart = text.lastIndexOf("\n", lr.start - 2) + 1;
		var prevEnd = lr.start;
		var prev = text.slice(prevStart, prevEnd);

		engine.captureBeforeState && engine.captureBeforeState();

		ta.value = text.slice(0, prevStart) + block + prev + text.slice(lr.end);

		var delta = block.length - prev.length;
		ta.selectionStart = s - prev.length + block.length;
		ta.selectionEnd = e - prev.length + block.length;

		engine.syncCursorFromDOM && engine.syncCursorFromDOM();
		engine.recordUndo && engine.recordUndo(true);
		engine.saveChanges && engine.saveChanges();
		engine.fixHeight && engine.fixHeight();
		return;
	}

	if(direction > 0) {
		if(lr.end >= text.length) return;
		var nextEnd = text.indexOf("\n", lr.end);
		if(nextEnd === -1) nextEnd = text.length;
		else nextEnd = nextEnd + 1;
		var next = text.slice(lr.end, nextEnd);

		engine.captureBeforeState && engine.captureBeforeState();

		ta.value = text.slice(0, lr.start) + next + block + text.slice(nextEnd);

		ta.selectionStart = s + next.length;
		ta.selectionEnd = e + next.length;

		engine.syncCursorFromDOM && engine.syncCursorFromDOM();
		engine.recordUndo && engine.recordUndo(true);
		engine.saveChanges && engine.saveChanges();
		engine.fixHeight && engine.fixHeight();
	}
};