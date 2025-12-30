/*\
title: $:/plugins/tiddlywiki/editor/smart-indent/smart-indent.js
type: application/javascript
module-type: editor-plugin

Smart indentation: auto-indent on Enter, Tab indent/outdent.

Enhanced Features:
- Configurable indent (tabs vs spaces, indent size)
- Multi-cursor Tab support
- Smart unindent (closing brace reduces indent)
- Numbered list continuation (1. 2. 3.)
- Blockquote continuation (>)
- Auto-dedent on empty list lines
- Code block awareness
- Definition list handling

\*/
"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "smart-indent";
exports.configTiddler = "$:/config/Editor/EnableSmartIndent";
exports.configTiddlerAlt = "$:/config/EnableSmartIndent";
exports.defaultEnabled = true;
exports.description = "Smart indentation: auto-indent on Enter, Tab indent/outdent";
exports.category = "editing";
exports.supports = { simple: true, framed: true };

// ==================== PLUGIN IMPLEMENTATION ====================
exports.create = function(engine) { return new SmartIndentPlugin(engine); };

function SmartIndentPlugin(engine) {
	this.engine = engine;
	this.name = "smart-indent";
	this.enabled = false;

	// Configuration
	this.config = {
		useTabs: true,           // true = tabs, false = spaces
		tabSize: 4,              // spaces per tab
		autoIndent: true,        // auto-indent on Enter
		smartUnindent: true,     // unindent on closing brace
		continueList: true,      // continue list markers
		continueQuote: true,     // continue blockquotes
		autoDedentEmpty: true,   // dedent on double-Enter in list
		detectFromContent: true  // detect indent style from content
	};

	// State
	this.lastLineWasEmptyList = false;
	this.detectedStyle = null;

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this),
		beforeInput: this.onBeforeInput.bind(this),
		afterInput: this.onAfterInput.bind(this)
	};
}

SmartIndentPlugin.prototype.enable = function() {
	this.enabled = true;
	this.detectIndentStyle();
};

SmartIndentPlugin.prototype.disable = function() {
	this.enabled = false;
};

SmartIndentPlugin.prototype.configure = function(options) {
	if (!options) return;
	if (options.useTabs !== undefined) this.config.useTabs = !!options.useTabs;
	if (options.tabSize !== undefined) this.config.tabSize = Math.max(1, Math.min(8, parseInt(options.tabSize, 10) || 4));
	if (options.autoIndent !== undefined) this.config.autoIndent = !!options.autoIndent;
	if (options.smartUnindent !== undefined) this.config.smartUnindent = !!options.smartUnindent;
	if (options.continueList !== undefined) this.config.continueList = !!options.continueList;
	if (options.continueQuote !== undefined) this.config.continueQuote = !!options.continueQuote;
	if (options.autoDedentEmpty !== undefined) this.config.autoDedentEmpty = !!options.autoDedentEmpty;
	if (options.detectFromContent !== undefined) this.config.detectFromContent = !!options.detectFromContent;
};

/**
 * Detect indent style from document content
 */
SmartIndentPlugin.prototype.detectIndentStyle = function() {
	if (!this.config.detectFromContent) return;
	
	var ta = this.engine.domNode;
	if (!ta) return;
	
	var text = ta.value || "";
	var lines = text.split("\n").slice(0, 100); // Check first 100 lines
	
	var tabCount = 0;
	var spaceCount = 0;
	var spaceSizes = {};
	
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		var match = line.match(/^(\s+)/);
		if (!match) continue;
		
		var indent = match[1];
		if (indent.indexOf("\t") !== -1) {
			tabCount++;
		} else {
			spaceCount++;
			var len = indent.length;
			spaceSizes[len] = (spaceSizes[len] || 0) + 1;
		}
	}
	
	if (tabCount > spaceCount) {
		this.detectedStyle = { useTabs: true };
	} else if (spaceCount > 0) {
		// Find most common space indent
		var mostCommon = 2;
		var maxCount = 0;
		for (var size in spaceSizes) {
			if (spaceSizes[size] > maxCount) {
				maxCount = spaceSizes[size];
				mostCommon = parseInt(size, 10);
			}
		}
		// Normalize to 2 or 4
		if (mostCommon >= 3) mostCommon = 4;
		else mostCommon = 2;
		
		this.detectedStyle = { useTabs: false, tabSize: mostCommon };
	}
};

/**
 * Get the indent string to use
 */
SmartIndentPlugin.prototype.getIndent = function() {
	var useTabs = this.detectedStyle ? this.detectedStyle.useTabs : this.config.useTabs;
	var tabSize = (this.detectedStyle && this.detectedStyle.tabSize) || this.config.tabSize;
	
	if (useTabs) {
		return "\t";
	} else {
		return " ".repeat(tabSize);
	}
};

/**
 * Handle keydown events
 */
SmartIndentPlugin.prototype.onKeydown = function(event) {
	if (!this.enabled) return;
	
	var ctrl = event.ctrlKey || event.metaKey;
	
	// Tab indentation
	if (event.key === "Tab" && !ctrl && !event.altKey) {
		event.preventDefault();
		if (event.shiftKey) {
			this.outdentSelection();
		} else {
			this.indentSelection();
		}
		return false;
	}
	
	// Smart unindent on closing braces
	if (this.config.smartUnindent && !ctrl && !event.altKey && !event.shiftKey) {
		if (event.key === "}" || event.key === "]" || event.key === ")") {
			if (this.shouldUnindentOnClose()) {
				this.unindentCurrentLine();
				// Don't prevent default - let the character be typed
			}
		}
	}
	
	// Ctrl+] / Ctrl+[ for indent/outdent
	if (ctrl && !event.altKey && !event.shiftKey) {
		if (event.key === "]") {
			event.preventDefault();
			this.indentSelection();
			return false;
		}
		if (event.key === "[") {
			event.preventDefault();
			this.outdentSelection();
			return false;
		}
	}
};

/**
 * Handle beforeinput for Enter key
 */
SmartIndentPlugin.prototype.onBeforeInput = function(event) {
	if (!this.enabled) return;
	if (!this.config.autoIndent) return;
	if (event.inputType !== "insertLineBreak" && event.inputType !== "insertParagraph") return;
	
	var ta = this.engine.domNode;
	var text = ta.value;
	var pos = ta.selectionStart;
	
	var lineStart = text.lastIndexOf("\n", pos - 1) + 1;
	var lineEnd = text.indexOf("\n", pos);
	if (lineEnd === -1) lineEnd = text.length;
	
	var line = text.substring(lineStart, lineEnd);
	var lineBeforeCursor = text.substring(lineStart, pos);
	
	// Compute base indentation
	var indentMatch = line.match(/^(\s*)/);
	var baseIndent = indentMatch ? indentMatch[1] : "";
	
	// Check for list patterns
	var listMatch = line.match(/^(\s*)([*#]+)\s*(.*)/);
	var numberedListMatch = line.match(/^(\s*)(\d+)\.\s*(.*)/);
	var definitionMatch = line.match(/^(\s*)(:+)\s*(.*)/);
	var blockquoteMatch = line.match(/^(\s*)(>+)\s*(.*)/);
	var codeFenceMatch = line.match(/^(\s*)```/);
	
	var insert = "\n";
	var dedent = false;
	
	// Handle empty list items (auto-dedent)
	if (this.config.autoDedentEmpty) {
		if (listMatch && !listMatch[3].trim()) {
			// Empty list item - remove marker and dedent
			event.preventDefault();
			this.removeListMarkerAndDedent(lineStart, pos);
			return false;
		}
		if (numberedListMatch && !numberedListMatch[3].trim()) {
			event.preventDefault();
			this.removeListMarkerAndDedent(lineStart, pos);
			return false;
		}
	}
	
	// Continue list markers
	if (this.config.continueList) {
		if (listMatch && listMatch[3].trim()) {
			insert = "\n" + listMatch[1] + listMatch[2] + " ";
		} else if (numberedListMatch && numberedListMatch[3].trim()) {
			var nextNum = parseInt(numberedListMatch[2], 10) + 1;
			insert = "\n" + numberedListMatch[1] + nextNum + ". ";
		} else if (definitionMatch && definitionMatch[3].trim()) {
			insert = "\n" + definitionMatch[1] + definitionMatch[2] + " ";
		}
	}
	
	// Continue blockquotes
	if (this.config.continueQuote && blockquoteMatch) {
		if (blockquoteMatch[3].trim()) {
			insert = "\n" + blockquoteMatch[1] + blockquoteMatch[2] + " ";
		} else {
			// Empty blockquote line - remove marker
			event.preventDefault();
			this.removeListMarkerAndDedent(lineStart, pos);
			return false;
		}
	}
	
	// Code fence - don't add markers inside
	if (codeFenceMatch) {
		insert = "\n" + baseIndent;
	}
	
	// If no special handling, just preserve base indent
	if (insert === "\n") {
		insert = "\n" + baseIndent;
	}
	
	// Check for auto-indent increase (after opening brace)
	var lastChar = lineBeforeCursor.trim().slice(-1);
	if (lastChar === "{" || lastChar === "[" || lastChar === "(") {
		var extraIndent = this.getIndent();
		insert += extraIndent;
	}
	
	// Check if closing brace follows cursor
	var charAfter = text.charAt(pos);
	var closingBraceFollows = (charAfter === "}" || charAfter === "]" || charAfter === ")");
	
	if (closingBraceFollows && (lastChar === "{" || lastChar === "[" || lastChar === "(")) {
		// Insert extra line for cursor, then closing brace on its own line
		var closeIndent = baseIndent;
		insert += "\n" + closeIndent;
		
		event.preventDefault();
		this.insertTextWithCursorInMiddle(insert, baseIndent.length + this.getIndent().length + 1);
		return false;
	}
	
	event.preventDefault();
	this.insertText(insert);
	return false;
};

/**
 * Track empty list lines for auto-dedent
 */
SmartIndentPlugin.prototype.onAfterInput = function(event) {
	// Detect indent style changes
	if (this.config.detectFromContent) {
		// Debounce detection
		var self = this;
		if (this._detectTimer) clearTimeout(this._detectTimer);
		this._detectTimer = setTimeout(function() {
			self.detectIndentStyle();
		}, 1000);
	}
};

/**
 * Insert text at cursor
 */
SmartIndentPlugin.prototype.insertText = function(s) {
	var engine = this.engine;
	
	if (engine.insertAtAllCursors) {
		engine.insertAtAllCursors(s);
	} else {
		var ta = engine.domNode;
		var text = ta.value;
		var a = ta.selectionStart, b = ta.selectionEnd;
		
		engine.captureBeforeState && engine.captureBeforeState();
		ta.value = text.slice(0, a) + s + text.slice(b);
		var p = a + s.length;
		ta.selectionStart = p;
		ta.selectionEnd = p;
		engine.syncCursorFromDOM && engine.syncCursorFromDOM();
		engine.recordUndo && engine.recordUndo(true);
		engine.saveChanges && engine.saveChanges();
		engine.fixHeight && engine.fixHeight();
	}
};

/**
 * Insert text with cursor positioned in middle (for brace completion)
 */
SmartIndentPlugin.prototype.insertTextWithCursorInMiddle = function(s, cursorOffset) {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var a = ta.selectionStart, b = ta.selectionEnd;
	
	engine.captureBeforeState && engine.captureBeforeState();
	ta.value = text.slice(0, a) + s + text.slice(b);
	var p = a + cursorOffset;
	ta.selectionStart = p;
	ta.selectionEnd = p;
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

/**
 * Remove list marker and dedent (for empty list lines)
 */
SmartIndentPlugin.prototype.removeListMarkerAndDedent = function(lineStart, cursorPos) {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	// Remove from line start to cursor
	ta.value = text.slice(0, lineStart) + text.slice(cursorPos);
	ta.selectionStart = lineStart;
	ta.selectionEnd = lineStart;
	
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

/**
 * Indent selection or all cursor lines
 */
SmartIndentPlugin.prototype.indentSelection = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var indent = this.getIndent();
	
	// Multi-cursor support
	if (engine.hasMultipleCursors && engine.hasMultipleCursors()) {
		this.indentMultiCursor(indent);
		return;
	}
	
	var s = ta.selectionStart;
	var e = ta.selectionEnd;
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	// No selection - just insert indent
	if (s === e) {
		ta.value = text.slice(0, s) + indent + text.slice(s);
		ta.selectionStart = s + indent.length;
		ta.selectionEnd = s + indent.length;
		engine.syncCursorFromDOM && engine.syncCursorFromDOM();
		engine.recordUndo && engine.recordUndo(true);
		engine.saveChanges && engine.saveChanges();
		engine.fixHeight && engine.fixHeight();
		return;
	}
	
	// Selection - indent all selected lines
	var lineStart = text.lastIndexOf("\n", s - 1) + 1;
	var lineEnd = text.indexOf("\n", e);
	if (lineEnd === -1) lineEnd = text.length;
	
	var block = text.slice(lineStart, lineEnd);
	var lines = block.split("\n");
	var indentedLines = lines.map(function(line) {
		return line.length > 0 ? indent + line : line;
	});
	var out = indentedLines.join("\n");
	
	var delta = out.length - block.length;
	
	ta.value = text.slice(0, lineStart) + out + text.slice(lineEnd);
	
	// Adjust selection
	var newStart = s + indent.length;
	var newEnd = e + delta;
	ta.selectionStart = newStart;
	ta.selectionEnd = newEnd;
	
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

/**
 * Indent with multi-cursor support
 */
SmartIndentPlugin.prototype.indentMultiCursor = function(indent) {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var cursors = engine.getCursors();
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	// Collect all lines that need indenting
	var linesToIndent = new Set();
	var lines = text.split("\n");
	var lineStarts = [];
	var pos = 0;
	for (var i = 0; i < lines.length; i++) {
		lineStarts.push(pos);
		pos += lines[i].length + 1;
	}
	
	// Find all lines touched by any cursor
	for (var c = 0; c < cursors.length; c++) {
		var cursor = cursors[c];
		var startLine = this.getLineNumber(text, cursor.start, lineStarts);
		var endLine = this.getLineNumber(text, cursor.end, lineStarts);
		for (var l = startLine; l <= endLine; l++) {
			if (lines[l].length > 0) {
				linesToIndent.add(l);
			}
		}
	}
	
	// Apply indents from bottom to top to preserve positions
	var sortedLines = Array.from(linesToIndent).sort(function(a, b) { return b - a; });
	for (var j = 0; j < sortedLines.length; j++) {
		var lineNum = sortedLines[j];
		var linePos = lineStarts[lineNum];
		text = text.slice(0, linePos) + indent + text.slice(linePos);
	}
	
	ta.value = text;
	
	// Adjust cursor positions
	for (c = 0; c < cursors.length; c++) {
		cursor = cursors[c];
		var adjustStart = 0;
		var adjustEnd = 0;
		
		for (j = 0; j < sortedLines.length; j++) {
			lineNum = sortedLines[j];
			var originalLinePos = lineStarts[lineNum];
			if (originalLinePos < cursor.start) adjustStart += indent.length;
			if (originalLinePos < cursor.end) adjustEnd += indent.length;
		}
		
		cursor.start += adjustStart;
		cursor.end += adjustEnd;
	}
	
	engine.sortAndMergeCursors && engine.sortAndMergeCursors();
	engine.syncDOMFromCursor && engine.syncDOMFromCursor();
	engine.renderCursors && engine.renderCursors();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

/**
 * Outdent selection
 */
SmartIndentPlugin.prototype.outdentSelection = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	
	// Multi-cursor support
	if (engine.hasMultipleCursors && engine.hasMultipleCursors()) {
		this.outdentMultiCursor();
		return;
	}
	
	var s = ta.selectionStart;
	var e = ta.selectionEnd;
	
	var lineStart = text.lastIndexOf("\n", s - 1) + 1;
	var lineEnd = text.indexOf("\n", e);
	if (lineEnd === -1) lineEnd = text.length;
	
	var block = text.slice(lineStart, lineEnd);
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	var tabSize = this.config.tabSize;
	var self = this;
	
	var out = block.split("\n").map(function(line) {
		if (line.startsWith("\t")) {
			return line.slice(1);
		}
		// Remove up to tabSize spaces
		var spaces = 0;
		for (var i = 0; i < line.length && i < tabSize; i++) {
			if (line[i] === " ") spaces++;
			else break;
		}
		return line.slice(spaces);
	}).join("\n");
	
	var delta = out.length - block.length;
	
	ta.value = text.slice(0, lineStart) + out + text.slice(lineEnd);
	
	// Adjust selection
	var newStart = Math.max(lineStart, s + delta);
	var newEnd = Math.max(newStart, e + delta);
	ta.selectionStart = newStart;
	ta.selectionEnd = newEnd;
	
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

/**
 * Outdent with multi-cursor support
 */
SmartIndentPlugin.prototype.outdentMultiCursor = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var cursors = engine.getCursors();
	var tabSize = this.config.tabSize;
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	var lines = text.split("\n");
	var lineStarts = [];
	var pos = 0;
	for (var i = 0; i < lines.length; i++) {
		lineStarts.push(pos);
		pos += lines[i].length + 1;
	}
	
	// Find all lines touched by any cursor
	var linesToOutdent = new Set();
	for (var c = 0; c < cursors.length; c++) {
		var cursor = cursors[c];
		var startLine = this.getLineNumber(text, cursor.start, lineStarts);
		var endLine = this.getLineNumber(text, cursor.end, lineStarts);
		for (var l = startLine; l <= endLine; l++) {
			linesToOutdent.add(l);
		}
	}
	
	// Calculate removals
	var removals = {}; // lineNum -> charsRemoved
	for (var lineNum of linesToOutdent) {
		var line = lines[lineNum];
		var removed = 0;
		if (line.startsWith("\t")) {
			removed = 1;
		} else {
			for (var j = 0; j < line.length && j < tabSize; j++) {
				if (line[j] === " ") removed++;
				else break;
			}
		}
		if (removed > 0) {
			removals[lineNum] = removed;
			lines[lineNum] = line.slice(removed);
		}
	}
	
	text = lines.join("\n");
	ta.value = text;
	
	// Adjust cursor positions
	for (c = 0; c < cursors.length; c++) {
		cursor = cursors[c];
		var adjustStart = 0;
		var adjustEnd = 0;
		
		// Recalculate line starts after modifications
		lineStarts = [];
		pos = 0;
		for (i = 0; i < lines.length; i++) {
			lineStarts.push(pos);
			pos += lines[i].length + 1;
		}
		
		for (lineNum in removals) {
			var ln = parseInt(lineNum, 10);
			var removed = removals[lineNum];
			var originalLineStart = 0;
			for (i = 0; i < ln; i++) {
				originalLineStart += lines[i].length + 1 + (removals[i] || 0);
			}
			
			if (originalLineStart < cursor.start) adjustStart -= removed;
			if (originalLineStart < cursor.end) adjustEnd -= removed;
		}
		
		cursor.start = Math.max(0, cursor.start + adjustStart);
		cursor.end = Math.max(cursor.start, cursor.end + adjustEnd);
	}
	
	engine.sortAndMergeCursors && engine.sortAndMergeCursors();
	engine.syncDOMFromCursor && engine.syncDOMFromCursor();
	engine.renderCursors && engine.renderCursors();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

/**
 * Get line number for a position
 */
SmartIndentPlugin.prototype.getLineNumber = function(text, pos, lineStarts) {
	for (var i = lineStarts.length - 1; i >= 0; i--) {
		if (pos >= lineStarts[i]) return i;
	}
	return 0;
};

/**
 * Check if we should unindent when typing closing brace
 */
SmartIndentPlugin.prototype.shouldUnindentOnClose = function() {
	var ta = this.engine.domNode;
	var text = ta.value;
	var pos = ta.selectionStart;
	
	// Get current line
	var lineStart = text.lastIndexOf("\n", pos - 1) + 1;
	var lineBeforeCursor = text.substring(lineStart, pos);
	
	// Only unindent if line is only whitespace before cursor
	return /^\s*$/.test(lineBeforeCursor);
};

/**
 * Unindent current line (for smart unindent on closing brace)
 */
SmartIndentPlugin.prototype.unindentCurrentLine = function() {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var pos = ta.selectionStart;
	
	var lineStart = text.lastIndexOf("\n", pos - 1) + 1;
	var lineBeforeCursor = text.substring(lineStart, pos);
	
	if (lineBeforeCursor.length === 0) return;
	
	engine.captureBeforeState && engine.captureBeforeState();
	
	var removed = 0;
	if (lineBeforeCursor.endsWith("\t")) {
		removed = 1;
	} else {
		for (var i = 0; i < this.config.tabSize && lineBeforeCursor.endsWith(" "); i++) {
			removed++;
			lineBeforeCursor = lineBeforeCursor.slice(0, -1);
		}
	}
	
	if (removed > 0) {
		ta.value = text.slice(0, pos - removed) + text.slice(pos);
		ta.selectionStart = pos - removed;
		ta.selectionEnd = pos - removed;
		
		engine.syncCursorFromDOM && engine.syncCursorFromDOM();
		engine.recordUndo && engine.recordUndo(true);
		engine.saveChanges && engine.saveChanges();
		engine.fixHeight && engine.fixHeight();
	}
};

/**
 * Get commands for command palette
 */
SmartIndentPlugin.prototype.getCommands = function() {
	var self = this;
	return [
		{
			name: "Indent Selection",
			category: "Editing",
			shortcut: "Tab",
			run: function() { self.indentSelection(); }
		},
		{
			name: "Outdent Selection",
			category: "Editing",
			shortcut: "Shift+Tab",
			run: function() { self.outdentSelection(); }
		},
		{
			name: "Toggle Tabs/Spaces",
			category: "Editing",
			run: function() {
				self.config.useTabs = !self.config.useTabs;
				self.detectedStyle = null;
			}
		},
		{
			name: "Set Indent Size: 2",
			category: "Editing",
			run: function() {
				self.config.tabSize = 2;
				self.config.useTabs = false;
				self.detectedStyle = null;
			}
		},
		{
			name: "Set Indent Size: 4",
			category: "Editing",
			run: function() {
				self.config.tabSize = 4;
				self.config.useTabs = false;
				self.detectedStyle = null;
			}
		}
	];
};

SmartIndentPlugin.prototype.destroy = function() {
	if (this._detectTimer) {
		clearTimeout(this._detectTimer);
		this._detectTimer = null;
	}
};