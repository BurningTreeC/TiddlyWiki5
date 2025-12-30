/*\
title: $:/plugins/tiddlywiki/editor/multi-cursor/multi-cursor.js
type: application/javascript
module-type: editor-plugin

Multi-cursor editing plugin for the TiddlyWiki editor.

Plugin Metadata:
- name: multi-cursor
- configTiddler: $:/config/Editor/EnableMultiCursor
- defaultEnabled: true

Behavior:
- Ctrl/Meta+Click: keeps the previous primary caret as a secondary cursor,
  and the clicked position becomes the new primary (native caret).
- Regular click: clears secondary cursors (unless Shift is held).

Shortcuts:
- Ctrl+Click: Add cursor while keeping previous positions
- Ctrl+D: Select next occurrence of selection/word
- Ctrl+Shift+L: Select all occurrences
- Alt+Shift+Up/Down: Add cursor above/below
- Escape: Clear secondary cursors
\*/

"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "multi-cursor";
exports.configTiddler = "$:/config/Editor/EnableMultiCursor";
exports.configTiddlerAlt = "$:/config/EnableMultiCursor";
exports.defaultEnabled = true;
exports.description = "Multi-cursor editing with Ctrl+Click, Ctrl+D, and more";
exports.category = "editing";
exports.supports = { simple: false, framed: true };

// ==================== PLUGIN IMPLEMENTATION ====================

exports.create = function(engine) {
	return new MultiCursorPlugin(engine);
};

function MultiCursorPlugin(engine) {
	this.engine = engine;
	this.name = "multi-cursor";
	this.enabled = false;

	// Ctrl-click bookkeeping
	this._pendingCtrlClick = false;
	this._ctrlClickPrevPrimary = null;

	this._onMouseDown = this.onMouseDownEvent.bind(this);
	this._onClick = this.onClickEvent.bind(this);

	this.hooks = {
		beforeKeydown: this.handleKeydown.bind(this)
	};
}

MultiCursorPlugin.prototype.onRegister = function() {
	var ta = this.engine.domNode;
	ta.addEventListener("mousedown", this._onMouseDown);
	ta.addEventListener("click", this._onClick);
};

MultiCursorPlugin.prototype.enable = function() {
	this.enabled = true;
};

MultiCursorPlugin.prototype.disable = function() {
	this.enabled = false;
	this._pendingCtrlClick = false;
	this._ctrlClickPrevPrimary = null;
	this.engine.clearSecondaryCursors();
};

MultiCursorPlugin.prototype.onMouseDownEvent = function(event) {
	if(!this.enabled) return;

	var engine = this.engine;
	var ta = engine.domNode;

	// Ctrl/Meta+Click:
	// store old primary *before* the browser changes caret
	if(event.ctrlKey || event.metaKey) {
		this._pendingCtrlClick = true;
		this._ctrlClickPrevPrimary = {
			start: ta.selectionStart,
			end: ta.selectionEnd
		};
		return; // IMPORTANT: do NOT preventDefault (caret must move)
	}

	// Regular click clears secondary cursors (but allow Shift selections)
	if(!event.shiftKey) {
		if(engine.getCursors().length > 1) {
			engine.clearSecondaryCursors();
		}
	}
};

MultiCursorPlugin.prototype.onClickEvent = function(event) {
	if(!this.enabled) return;

	if(!(event.ctrlKey || event.metaKey)) return;
	if(!this._pendingCtrlClick) return;

	var engine = this.engine;
	var ta = engine.domNode;

	this._pendingCtrlClick = false;

	// After click, browser has moved caret, and engine.handleClickEvent()
	// likely already synced primary to the new caret.
	var prev = this._ctrlClickPrevPrimary;
	this._ctrlClickPrevPrimary = null;

	// Next-tick ensures selectionStart is final in more browsers
	setTimeout(function() {
		if(!engine || !engine.domNode) return;

		var newStart = ta.selectionStart;
		var newEnd = ta.selectionEnd;

		// Ensure engine cursor model matches DOM (primary becomes the clicked caret)
		engine.syncCursorFromDOM();

		// If previous primary existed and is different, keep it as a secondary cursor
		if(prev && (prev.start !== newStart || prev.end !== newEnd)) {
			// Don't duplicate if it already exists
			var exists = engine.getCursors().some(function(c) {
				return c.start === prev.start && c.end === prev.end;
			});
			if(!exists) {
				engine.addCursor(prev.end, { start: prev.start, end: prev.end });
			}
		}

		// Also: if click created a selection (drag), keep it as primary only.
		// If you want ctrl+click-drag to add another cursor too, that's a different rule.

		engine.sortAndMergeCursors();
		engine.renderCursors();
	}, 0);
};

MultiCursorPlugin.prototype.handleKeydown = function(event, data, engine) {
	if(!this.enabled) return;

	var dominated = event.ctrlKey || event.metaKey;

	// Escape clears secondary cursors
	if(event.key === "Escape") {
		if(engine.getCursors().length > 1) {
			event.preventDefault();
			engine.clearSecondaryCursors();
			return false;
		}
	}

	// Ctrl+D: select next occurrence
	if(dominated && String(event.key).toLowerCase() === "d") {
		event.preventDefault();
		this.selectNextOccurrence();
		return false;
	}

	// Ctrl+Shift+L: select all occurrences
	if(dominated && event.shiftKey && String(event.key).toLowerCase() === "l") {
		event.preventDefault();
		this.selectAllOccurrences();
		return false;
	}

	// Alt+Shift+Up/Down: add cursor above/below
	if(event.altKey && event.shiftKey) {
		if(event.key === "ArrowUp") {
			event.preventDefault();
			this.addCursorInDirection(-1);
			return false;
		}
		if(event.key === "ArrowDown") {
			event.preventDefault();
			this.addCursorInDirection(1);
			return false;
		}
	}

	// Multi-cursor movement
	if(engine.getCursors().length > 1) {
		if(this.handleMultiCursorMovement(event)) {
			return false;
		}
	}
};

MultiCursorPlugin.prototype.selectNextOccurrence = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;

	engine.sortAndMergeCursors();
	var cursors = engine.getCursors();

	var selStart = ta.selectionStart;
	var selEnd = ta.selectionEnd;

	if(selStart === selEnd) {
		var bounds = engine.getWordBoundsAt(selStart);
		ta.setSelectionRange(bounds.start, bounds.end);
		engine.syncCursorFromDOM();
		return;
	}

	var selectedText = text.substring(selStart, selEnd);
	if(!selectedText) return;

	var lastCursor = cursors[cursors.length - 1];
	var searchStart = lastCursor.end;

	var nextIndex = text.indexOf(selectedText, searchStart);
	if(nextIndex === -1) nextIndex = text.indexOf(selectedText);
	if(nextIndex === -1) return;

	var exists = cursors.some(function(c) {
		return c.start === nextIndex && c.end === nextIndex + selectedText.length;
	});
	if(exists) return;

	engine.addCursor(nextIndex + selectedText.length, {
		start: nextIndex,
		end: nextIndex + selectedText.length
	});
};

MultiCursorPlugin.prototype.selectAllOccurrences = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;

	var selStart = ta.selectionStart;
	var selEnd = ta.selectionEnd;

	if(selStart === selEnd) {
		var bounds = engine.getWordBoundsAt(selStart);
		selStart = bounds.start;
		selEnd = bounds.end;
		ta.setSelectionRange(selStart, selEnd);
		engine.syncCursorFromDOM();
	}

	var selectedText = text.substring(selStart, selEnd);
	if(!selectedText) return;

	engine.clearSecondaryCursors();

	var index = 0;
	var first = true;

	while((index = text.indexOf(selectedText, index)) !== -1) {
		if(first) {
			var primary = engine.getPrimaryCursor();
			primary.start = index;
			primary.end = index + selectedText.length;
			first = false;
		} else {
			engine.addCursor(index + selectedText.length, {
				start: index,
				end: index + selectedText.length
			});
		}
		index += selectedText.length;
	}

	engine.syncDOMFromCursor();
	engine.renderCursors();
};

MultiCursorPlugin.prototype.addCursorInDirection = function(direction) {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;

	engine.sortAndMergeCursors();
	var cursors = engine.getCursors();

	var reference = (direction > 0) ? cursors[cursors.length - 1] : cursors[0];
	var info = engine.getLineInfo(reference.end);
	var targetLine = info.line + direction;

	var lines = text.split("\n");
	if(targetLine < 0 || targetLine >= lines.length) return;

	var targetCol = Math.min(info.column, lines[targetLine].length);
	var targetPos = engine.getPositionForLineColumn(targetLine, targetCol);

	engine.addCursor(targetPos);
};

MultiCursorPlugin.prototype.handleMultiCursorMovement = function(event) {
	var engine = this.engine;
	var dominated = event.ctrlKey || event.metaKey;
	var shift = event.shiftKey;

	var movement = null;
	switch(event.key) {
		case "ArrowLeft": movement = dominated ? "wordLeft" : "left"; break;
		case "ArrowRight": movement = dominated ? "wordRight" : "right"; break;
		case "ArrowUp": movement = "up"; break;
		case "ArrowDown": movement = "down"; break;
		case "Home": movement = dominated ? "docStart" : "lineStart"; break;
		case "End": movement = dominated ? "docEnd" : "lineEnd"; break;
	}
	if(!movement) return false;

	event.preventDefault();

	var text = engine.domNode.value;
	var cursors = engine.getCursors();

	for(var i = 0; i < cursors.length; i++) {
		var c = cursors[i];
		var newPos = this.calculateNewPosition(text, c.end, movement);

		if(shift) {
			c.end = newPos;
			if(c.end < c.start) { var tmp = c.start; c.start = c.end; c.end = tmp; }
		} else {
			c.start = newPos;
			c.end = newPos;
		}
	}

	engine.sortAndMergeCursors();
	engine.syncDOMFromCursor();
	engine.renderCursors();
	return true;
};

MultiCursorPlugin.prototype.calculateNewPosition = function(text, position, movement) {
	var engine = this.engine;
	var info = engine.getLineInfo(position);
	var lines = text.split("\n");

	switch(movement) {
		case "left": return Math.max(0, position - 1);
		case "right": return Math.min(text.length, position + 1);
		case "wordLeft": return this.findWordBoundaryLeft(text, position);
		case "wordRight": return this.findWordBoundaryRight(text, position);
		case "up":
			if(info.line === 0) return 0;
			return engine.getPositionForLineColumn(info.line - 1, Math.min(info.column, lines[info.line - 1].length));
		case "down":
			if(info.line >= lines.length - 1) return text.length;
			return engine.getPositionForLineColumn(info.line + 1, Math.min(info.column, lines[info.line + 1].length));
		case "lineStart": return info.lineStart;
		case "lineEnd": return info.lineStart + info.lineText.length;
		case "docStart": return 0;
		case "docEnd": return text.length;
	}
	return position;
};

MultiCursorPlugin.prototype.findWordBoundaryLeft = function(text, position) {
	if(position === 0) return 0;
	var pos = position - 1;
	while(pos > 0 && /\s/.test(text[pos])) pos--;
	while(pos > 0 && /\w/.test(text[pos - 1])) pos--;
	return pos;
};

MultiCursorPlugin.prototype.findWordBoundaryRight = function(text, position) {
	if(position >= text.length) return text.length;
	var pos = position;
	while(pos < text.length && /\w/.test(text[pos])) pos++;
	while(pos < text.length && /\s/.test(text[pos])) pos++;
	return pos;
};

MultiCursorPlugin.prototype.destroy = function() {
	if(this.engine && this.engine.domNode) {
		this.engine.domNode.removeEventListener("mousedown", this._onMouseDown);
		this.engine.domNode.removeEventListener("click", this._onClick);
	}
};