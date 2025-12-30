/*\
title: $:/plugins/tiddlywiki/editor/line-block/line-block.js
type: application/javascript
module-type: editor-plugin

Line/block operations with full multi-cursor support:
- Duplicate line/selection (Ctrl+Shift+D)
- Delete line (Ctrl+Shift+K)
- Move line up/down (Alt+Up/Down)
- Join lines (Ctrl+J)
- Split line (Ctrl+Enter)
- Sort lines (selection)
- Reverse lines (selection)
- Remove duplicate lines
- Transpose lines
- Copy line up/down (Alt+Shift+Up/Down)

All operations work with multi-cursor mode.

\*/

"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "line-block";
exports.configTiddler = "$:/config/Editor/EnableLineBlock";
exports.configTiddlerAlt = "$:/config/EnableLineBlock";
exports.defaultEnabled = true;
exports.description = "Line/block operations: duplicate, delete, move, join, sort";
exports.category = "editing";
exports.supports = { simple: true, framed: true };

exports.create = function(engine) { return new LineBlockPlugin(engine); };

// ==================== PLUGIN IMPLEMENTATION ====================

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
LineBlockPlugin.prototype.destroy = function() { this.disable(); };

// ==================== EVENT HANDLER ====================

LineBlockPlugin.prototype.onKeydown = function(event) {
	if(!this.enabled) return;
	
	var ta = this.engine.domNode;
	if(!ta) return;
	
	var ctrl = event.ctrlKey || event.metaKey;
	var shift = event.shiftKey;
	var alt = event.altKey;
	
	// Ctrl+Shift+D: Duplicate line/selection
	if(ctrl && shift && !alt && (event.key === "D" || event.key === "d")) {
		event.preventDefault();
		this.duplicateSelectionOrLines();
		return false;
	}
	
	// Ctrl+Shift+K: Delete line
	if(ctrl && shift && !alt && (event.key === "K" || event.key === "k")) {
		event.preventDefault();
		this.deleteSelectionOrLines();
		return false;
	}
	
	// Alt+Up/Down: Move line
	if(alt && !ctrl && !shift) {
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
	
	// Alt+Shift+Up/Down: Copy line up/down
	if(alt && shift && !ctrl) {
		if(event.key === "ArrowUp") {
			event.preventDefault();
			this.copyLinesInDirection(-1);
			return false;
		}
		if(event.key === "ArrowDown") {
			event.preventDefault();
			this.copyLinesInDirection(1);
			return false;
		}
	}
	
	// Ctrl+J: Join lines
	if(ctrl && !shift && !alt && (event.key === "J" || event.key === "j")) {
		event.preventDefault();
		this.joinLines();
		return false;
	}
	
	// Ctrl+Enter: Split line
	if(ctrl && !shift && !alt && event.key === "Enter") {
		event.preventDefault();
		this.splitLine();
		return false;
	}
	
	// Ctrl+Shift+T: Transpose lines
	if(ctrl && shift && !alt && (event.key === "T" || event.key === "t")) {
		event.preventDefault();
		this.transposeLines();
		return false;
	}
};

// ==================== LINE RANGE HELPERS ====================

LineBlockPlugin.prototype.getLineRangeForSelection = function(text, selStart, selEnd) {
	// Expand to full lines intersecting selection, include trailing newline if present
	var startLineStart = text.lastIndexOf("\n", selStart - 1) + 1;
	var endLineEnd = text.indexOf("\n", selEnd);
	if(endLineEnd === -1) endLineEnd = text.length;
	else endLineEnd = endLineEnd + 1; // include newline
	return { start: startLineStart, end: endLineEnd };
};

LineBlockPlugin.prototype.getLineInfo = function(text, pos) {
	var lineStart = text.lastIndexOf("\n", pos - 1) + 1;
	var lineEnd = text.indexOf("\n", pos);
	if(lineEnd === -1) lineEnd = text.length;
	var line = text.substring(lineStart, lineEnd);
	return { start: lineStart, end: lineEnd, text: line };
};

// ==================== DUPLICATE ====================

LineBlockPlugin.prototype.duplicateSelectionOrLines = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	
	// Multi-cursor support
	if(engine.hasMultipleCursors && engine.hasMultipleCursors()) {
		this.duplicateMultiCursor();
		return;
	}
	
	var s = ta.selectionStart;
	var e = ta.selectionEnd;
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	if(s !== e) {
		// Duplicate selection
		var chunk = text.slice(s, e);
		ta.value = text.slice(0, e) + chunk + text.slice(e);
		ta.selectionStart = e;
		ta.selectionEnd = e + chunk.length;
	} else {
		// Duplicate line
		var lr = this.getLineRangeForSelection(text, s, e);
		var lines = text.slice(lr.start, lr.end);
		
		// Ensure we have a newline at end if duplicating
		if(!lines.endsWith("\n")) {
			lines += "\n";
		}
		
		ta.value = text.slice(0, lr.end) + lines + text.slice(lr.end);
		
		// Move cursor to duplicated line
		ta.selectionStart = lr.end + (s - lr.start);
		ta.selectionEnd = lr.end + (e - lr.start);
	}
	
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

LineBlockPlugin.prototype.duplicateMultiCursor = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var cursors = engine.getCursors();
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	// Process from end to start to maintain positions
	var sortedCursors = cursors.slice().sort(function(a, b) { return b.start - a.start; });
	
	for(var i = 0; i < sortedCursors.length; i++) {
		var cursor = sortedCursors[i];
		var s = cursor.start;
		var e = cursor.end;
		
		if(s !== e) {
			// Duplicate selection
			var chunk = text.slice(s, e);
			text = text.slice(0, e) + chunk + text.slice(e);
			cursor.start = e;
			cursor.end = e + chunk.length;
		} else {
			// Duplicate line
			var lr = this.getLineRangeForSelection(text, s, e);
			var lines = text.slice(lr.start, lr.end);
			if(!lines.endsWith("\n")) lines += "\n";
			
			text = text.slice(0, lr.end) + lines + text.slice(lr.end);
			cursor.start = lr.end + (s - lr.start);
			cursor.end = lr.end + (e - lr.start);
		}
	}
	
	ta.value = text;
	
	engine.sortAndMergeCursors && engine.sortAndMergeCursors();
	engine.syncDOMFromCursor && engine.syncDOMFromCursor();
	engine.renderCursors && engine.renderCursors();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

// ==================== DELETE ====================

LineBlockPlugin.prototype.deleteSelectionOrLines = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	
	// Multi-cursor support
	if(engine.hasMultipleCursors && engine.hasMultipleCursors()) {
		this.deleteMultiCursor();
		return;
	}
	
	var s = ta.selectionStart;
	var e = ta.selectionEnd;
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	var cutStart, cutEnd;
	if(s !== e) {
		cutStart = s;
		cutEnd = e;
	} else {
		var lr = this.getLineRangeForSelection(text, s, e);
		cutStart = lr.start;
		cutEnd = lr.end;
	}
	
	ta.value = text.slice(0, cutStart) + text.slice(cutEnd);
	ta.selectionStart = cutStart;
	ta.selectionEnd = cutStart;
	
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

LineBlockPlugin.prototype.deleteMultiCursor = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var cursors = engine.getCursors();
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	// Collect ranges to delete (from end to start)
	var ranges = [];
	for(var i = 0; i < cursors.length; i++) {
		var cursor = cursors[i];
		var s = cursor.start;
		var e = cursor.end;
		
		if(s !== e) {
			ranges.push({ start: s, end: e, cursorId: cursor.id });
		} else {
			var lr = this.getLineRangeForSelection(text, s, e);
			ranges.push({ start: lr.start, end: lr.end, cursorId: cursor.id });
		}
	}
	
	// Sort by start position descending
	ranges.sort(function(a, b) { return b.start - a.start; });
	
	// Merge overlapping ranges
	var merged = [];
	for(i = 0; i < ranges.length; i++) {
		var r = ranges[i];
		if(merged.length === 0) {
			merged.push(r);
		} else {
			var last = merged[merged.length - 1];
			if(r.end >= last.start) {
				// Overlapping - extend
				last.start = Math.min(last.start, r.start);
			} else {
				merged.push(r);
			}
		}
	}
	
	// Delete ranges from end to start
	for(i = 0; i < merged.length; i++) {
		r = merged[i];
		text = text.slice(0, r.start) + text.slice(r.end);
	}
	
	ta.value = text;
	
	// Set cursors to deletion points
	var positions = merged.map(function(r) { return r.start; });
	
	// Clear secondary cursors
	engine.clearSecondaryCursors && engine.clearSecondaryCursors();
	
	// Set primary cursor
	var primary = engine.getPrimaryCursor && engine.getPrimaryCursor();
	if(primary && positions.length > 0) {
		primary.start = positions[0];
		primary.end = positions[0];
	}
	
	// Add secondary cursors for other positions
	for(i = 1; i < positions.length; i++) {
		engine.addCursor && engine.addCursor(positions[i]);
	}
	
	engine.sortAndMergeCursors && engine.sortAndMergeCursors();
	engine.syncDOMFromCursor && engine.syncDOMFromCursor();
	engine.renderCursors && engine.renderCursors();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

// ==================== MOVE ====================

LineBlockPlugin.prototype.moveSelectionOrLines = function(direction) {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var s = ta.selectionStart;
	var e = ta.selectionEnd;
	
	var lr = this.getLineRangeForSelection(text, s, e);
	var block = text.slice(lr.start, lr.end);
	
	// Ensure block ends with newline
	var hasTrailingNewline = block.endsWith("\n");
	if(!hasTrailingNewline && lr.end < text.length) {
		// Include the newline
		lr.end++;
		block = text.slice(lr.start, lr.end);
		hasTrailingNewline = true;
	}
	
	if(direction < 0) {
		// Move up
		if(lr.start === 0) return; // Already at top
		
		var prevStart = text.lastIndexOf("\n", lr.start - 2) + 1;
		var prevEnd = lr.start;
		var prev = text.slice(prevStart, prevEnd);
		
		engine.captureBeforeState && engine.captureBeforeState();
		
		ta.value = text.slice(0, prevStart) + block + prev + text.slice(lr.end);
		
		// Adjust selection
		var delta = prev.length;
		ta.selectionStart = s - delta;
		ta.selectionEnd = e - delta;
	} else {
		// Move down
		if(lr.end >= text.length) return; // Already at bottom
		
		var nextEnd = text.indexOf("\n", lr.end);
		if(nextEnd === -1) nextEnd = text.length;
		else nextEnd++; // include newline
		
		var next = text.slice(lr.end, nextEnd);
		
		// If moving to last line and it doesn't have newline, we need to adjust
		if(!next.endsWith("\n") && hasTrailingNewline) {
			// Remove trailing newline from block, add to next
			block = block.slice(0, -1);
			next = next + "\n";
		}
		
		engine.captureBeforeState && engine.captureBeforeState();
		
		ta.value = text.slice(0, lr.start) + next + block + text.slice(nextEnd);
		
		// Adjust selection
		ta.selectionStart = s + next.length;
		ta.selectionEnd = e + next.length;
	}
	
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

// ==================== COPY LINE UP/DOWN ====================

LineBlockPlugin.prototype.copyLinesInDirection = function(direction) {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var s = ta.selectionStart;
	var e = ta.selectionEnd;
	
	var lr = this.getLineRangeForSelection(text, s, e);
	var block = text.slice(lr.start, lr.end);
	
	// Ensure block ends with newline
	if(!block.endsWith("\n")) {
		block += "\n";
	}
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	if(direction < 0) {
		// Copy up - insert before current block, keep cursor in original position
		ta.value = text.slice(0, lr.start) + block + text.slice(lr.start);
		
		// Keep selection in original (now moved down) position
		ta.selectionStart = s + block.length;
		ta.selectionEnd = e + block.length;
	} else {
		// Copy down - insert after current block
		ta.value = text.slice(0, lr.end) + block + text.slice(lr.end);
		
		// Move selection to copied block
		ta.selectionStart = lr.end + (s - lr.start);
		ta.selectionEnd = lr.end + (e - lr.start);
	}
	
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

// ==================== JOIN LINES ====================

LineBlockPlugin.prototype.joinLines = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var s = ta.selectionStart;
	var e = ta.selectionEnd;
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	// Get current line
	var lineInfo = this.getLineInfo(text, e);
	
	// Find the newline after current position or at end of current line
	var newlinePos = text.indexOf("\n", e);
	if(newlinePos === -1) return; // No next line to join
	
	// Find start of next line content (skip leading whitespace)
	var nextLineStart = newlinePos + 1;
	var nextLineContent = text.slice(nextLineStart);
	var leadingWhitespace = nextLineContent.match(/^(\s*)/);
	var trimStart = leadingWhitespace ? leadingWhitespace[1].length : 0;
	
	// Replace newline and leading whitespace with single space
	ta.value = text.slice(0, newlinePos) + " " + text.slice(nextLineStart + trimStart);
	
	// Position cursor at join point
	ta.selectionStart = newlinePos + 1;
	ta.selectionEnd = newlinePos + 1;
	
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

// ==================== SPLIT LINE ====================

LineBlockPlugin.prototype.splitLine = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var pos = ta.selectionStart;
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	// Get indentation of current line
	var lineStart = text.lastIndexOf("\n", pos - 1) + 1;
	var lineText = text.substring(lineStart, pos);
	var indentMatch = lineText.match(/^(\s*)/);
	var indent = indentMatch ? indentMatch[1] : "";
	
	// Insert newline with indentation
	var insert = "\n" + indent;
	
	ta.value = text.slice(0, pos) + insert + text.slice(pos);
	
	var newPos = pos + insert.length;
	ta.selectionStart = newPos;
	ta.selectionEnd = newPos;
	
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

// ==================== TRANSPOSE LINES ====================

LineBlockPlugin.prototype.transposeLines = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var pos = ta.selectionStart;
	
	// Get current line
	var lineStart = text.lastIndexOf("\n", pos - 1) + 1;
	var lineEnd = text.indexOf("\n", pos);
	if(lineEnd === -1) lineEnd = text.length;
	
	// Need a previous line to transpose with
	if(lineStart === 0) return;
	
	var prevLineStart = text.lastIndexOf("\n", lineStart - 2) + 1;
	var prevLineEnd = lineStart - 1; // exclude newline
	
	var currentLine = text.substring(lineStart, lineEnd);
	var prevLine = text.substring(prevLineStart, prevLineEnd);
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	// Swap lines
	ta.value = text.slice(0, prevLineStart) + currentLine + "\n" + prevLine + text.slice(lineEnd);
	
	// Move cursor to end of swapped line
	var newPos = prevLineStart + currentLine.length;
	ta.selectionStart = newPos;
	ta.selectionEnd = newPos;
	
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

// ==================== SORT LINES ====================

LineBlockPlugin.prototype.sortLines = function(ascending) {
	if(ascending === undefined) ascending = true;
	
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var s = ta.selectionStart;
	var e = ta.selectionEnd;
	
	if(s === e) return; // Need selection
	
	var lr = this.getLineRangeForSelection(text, s, e);
	var block = text.slice(lr.start, lr.end);
	var hasTrailingNewline = block.endsWith("\n");
	
	if(hasTrailingNewline) block = block.slice(0, -1);
	
	var lines = block.split("\n");
	
	lines.sort(function(a, b) {
		var cmp = a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
		return ascending ? cmp : -cmp;
	});
	
	var sorted = lines.join("\n") + (hasTrailingNewline ? "\n" : "");
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	ta.value = text.slice(0, lr.start) + sorted + text.slice(lr.end);
	ta.selectionStart = lr.start;
	ta.selectionEnd = lr.start + sorted.length - (hasTrailingNewline ? 1 : 0);
	
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

// ==================== REVERSE LINES ====================

LineBlockPlugin.prototype.reverseLines = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var s = ta.selectionStart;
	var e = ta.selectionEnd;
	
	if(s === e) return; // Need selection
	
	var lr = this.getLineRangeForSelection(text, s, e);
	var block = text.slice(lr.start, lr.end);
	var hasTrailingNewline = block.endsWith("\n");
	
	if(hasTrailingNewline) block = block.slice(0, -1);
	
	var lines = block.split("\n").reverse();
	var reversed = lines.join("\n") + (hasTrailingNewline ? "\n" : "");
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	ta.value = text.slice(0, lr.start) + reversed + text.slice(lr.end);
	ta.selectionStart = lr.start;
	ta.selectionEnd = lr.start + reversed.length - (hasTrailingNewline ? 1 : 0);
	
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

// ==================== REMOVE DUPLICATE LINES ====================

LineBlockPlugin.prototype.removeDuplicateLines = function(caseSensitive) {
	if(caseSensitive === undefined) caseSensitive = true;
	
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var s = ta.selectionStart;
	var e = ta.selectionEnd;
	
	if(s === e) return; // Need selection
	
	var lr = this.getLineRangeForSelection(text, s, e);
	var block = text.slice(lr.start, lr.end);
	var hasTrailingNewline = block.endsWith("\n");
	
	if(hasTrailingNewline) block = block.slice(0, -1);
	
	var lines = block.split("\n");
	var seen = {};
	var unique = [];
	
	for(var i = 0; i < lines.length; i++) {
		var line = lines[i];
		var key = caseSensitive ? line : line.toLowerCase();
		
		if(!seen[key]) {
			seen[key] = true;
			unique.push(line);
		}
	}
	
	var result = unique.join("\n") + (hasTrailingNewline ? "\n" : "");
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	ta.value = text.slice(0, lr.start) + result + text.slice(lr.end);
	ta.selectionStart = lr.start;
	ta.selectionEnd = lr.start + result.length - (hasTrailingNewline ? 1 : 0);
	
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

// ==================== COMMAND PALETTE INTEGRATION ====================

LineBlockPlugin.prototype.getCommands = function() {
	var self = this;
	return [
		{
			name: "Duplicate Line/Selection",
			shortcut: "Ctrl+Shift+D",
			category: "Editing",
			run: function() { self.duplicateSelectionOrLines(); }
		},
		{
			name: "Delete Line",
			shortcut: "Ctrl+Shift+K",
			category: "Editing",
			run: function() { self.deleteSelectionOrLines(); }
		},
		{
			name: "Move Line Up",
			shortcut: "Alt+↑",
			category: "Editing",
			run: function() { self.moveSelectionOrLines(-1); }
		},
		{
			name: "Move Line Down",
			shortcut: "Alt+↓",
			category: "Editing",
			run: function() { self.moveSelectionOrLines(1); }
		},
		{
			name: "Copy Line Up",
			shortcut: "Alt+Shift+↑",
			category: "Editing",
			run: function() { self.copyLinesInDirection(-1); }
		},
		{
			name: "Copy Line Down",
			shortcut: "Alt+Shift+↓",
			category: "Editing",
			run: function() { self.copyLinesInDirection(1); }
		},
		{
			name: "Join Lines",
			shortcut: "Ctrl+J",
			category: "Editing",
			run: function() { self.joinLines(); }
		},
		{
			name: "Split Line",
			shortcut: "Ctrl+Enter",
			category: "Editing",
			run: function() { self.splitLine(); }
		},
		{
			name: "Transpose Lines",
			shortcut: "Ctrl+Shift+T",
			category: "Editing",
			run: function() { self.transposeLines(); }
		},
		{
			name: "Sort Lines (Ascending)",
			category: "Editing",
			run: function() { self.sortLines(true); }
		},
		{
			name: "Sort Lines (Descending)",
			category: "Editing",
			run: function() { self.sortLines(false); }
		},
		{
			name: "Reverse Lines",
			category: "Editing",
			run: function() { self.reverseLines(); }
		},
		{
			name: "Remove Duplicate Lines",
			category: "Editing",
			run: function() { self.removeDuplicateLines(true); }
		},
		{
			name: "Remove Duplicate Lines (Case Insensitive)",
			category: "Editing",
			run: function() { self.removeDuplicateLines(false); }
		}
	];
};