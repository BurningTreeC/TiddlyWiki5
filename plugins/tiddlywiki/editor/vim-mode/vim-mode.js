/*\
title: $:/plugins/tiddlywiki/editor/vim-mode/vim-mode.js
type: application/javascript
module-type: editor-plugin

Vim keybinding mode for the TiddlyWiki editor.
Production-ready fixes:
- Correct undo integration (captureBeforeState -> mutate -> recordUndo)
- Linewise registers stored as objects (no â€œproperty on stringâ€ bug)
- Correct G/count logic
- operatorCount reset
- iframe-safe computedStyle usage
- doesnâ€™t crash if optional methods arenâ€™t implemented (safe fallbacks)

Note: This is a pragmatic Vim subset. It avoids crashing and integrates cleanly with your engine.
\*/

"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "vim-mode";
exports.configTiddler = "$:/config/Editor/EnableVimMode";
exports.configTiddlerAlt = "$:/config/EnableVimMode";
exports.defaultEnabled = false;
exports.description = "Vim keybinding mode for modal editing";
exports.category = "input";

// ==================== PLUGIN IMPLEMENTATION ====================


var MODES = {
	NORMAL: "normal",
	INSERT: "insert",
	VISUAL: "visual",
	VISUAL_LINE: "visual-line",
	COMMAND: "command",
	REPLACE: "replace"
};

exports.create = function(engine) {
	return new VimModePlugin(engine);
};

function VimModePlugin(engine) {
	this.engine = engine;
	this.name = "vim-mode";
	this.enabled = false;

	this.mode = MODES.NORMAL;
	this.commandBuffer = "";
	this.repeatCount = 0;
	this.operatorCount = 0;

	// Registers are objects: {text, isLine}
	this.registers = { '"': {text:"", isLine:false}, '0': {text:"", isLine:false}, '-': {text:"", isLine:false} };
	this.marks = {};
	this.lastSearch = "";
	this.searchDirection = 1;
	this.lastCommand = null;
	this.visualStart = 0;
	this.insertStartPos = 0;

	this.modeIndicator = null;
	this.commandLine = null;
	this.blockCursor = null;

	this.hooks = {
		beforeKeydown: this.handleKeydown.bind(this),
		focus: this.handleFocus.bind(this),
		blur: this.handleBlur.bind(this)
	};
}

VimModePlugin.prototype.onRegister = function() {
	this.createUI();
};

VimModePlugin.prototype.enable = function() {
	this.enabled = true;
	this.mode = MODES.NORMAL;
	// Vim and multi-cursor donâ€™t mix well: force single cursor
	this.engine.clearSecondaryCursors();
	this.updateUI();
	this.showModeIndicator();
};

VimModePlugin.prototype.disable = function() {
	this.enabled = false;
	this.hideModeIndicator();
	this.hideBlockCursor();
	this.hideCommandLine();
	this.engine.domNode.style.caretColor = "";
};

VimModePlugin.prototype.isInInsertMode = function() {
	return this.mode === MODES.INSERT;
};

VimModePlugin.prototype.createUI = function() {
	var iframeDoc = this.engine.getDocument();
	var wrapper = this.engine.getWrapperNode();
	var parentDoc = this.engine.widget.document;

	this.modeIndicator = parentDoc.createElement("div");
	this.modeIndicator.className = "tc-vim-mode-indicator";
	this.modeIndicator.style.cssText =
		"display:none;padding:2px 8px;font-size:12px;font-family:monospace;" +
		"background:#333;color:#fff;position:absolute;bottom:-20px;left:0;z-index:10;";
	wrapper.appendChild(this.modeIndicator);

	this.commandLine = parentDoc.createElement("div");
	this.commandLine.className = "tc-vim-command-line";
	this.commandLine.style.cssText =
		"display:none;padding:2px 8px;font-size:12px;font-family:monospace;" +
		"background:#222;color:#fff;position:absolute;bottom:-20px;left:0;right:0;z-index:10;";
	wrapper.appendChild(this.commandLine);

	this.blockCursor = iframeDoc.createElement("div");
	this.blockCursor.className = "tc-vim-block-cursor";
	this.blockCursor.style.cssText =
		"display:none;position:absolute;background:rgba(100,150,255,0.5);pointer-events:none;";
	this.engine.getOverlayLayer().appendChild(this.blockCursor);
};

VimModePlugin.prototype.handleKeydown = function(event) {
	if(!this.enabled) return;

	// Always handle Escape
	if(event.key === "Escape") {
		event.preventDefault();
		this.enterNormalMode();
		return false;
	}

	// If multi-cursor exists, kill it for safety
	if(this.engine.getCursors().length > 1) {
		this.engine.clearSecondaryCursors();
	}

	var handled = false;
	switch(this.mode) {
		case MODES.NORMAL: handled = this.handleNormalMode(event); break;
		case MODES.INSERT: handled = this.handleInsertMode(event); break;
		case MODES.VISUAL:
		case MODES.VISUAL_LINE: handled = this.handleVisualMode(event); break;
		case MODES.COMMAND: handled = this.handleCommandMode(event); break;
		case MODES.REPLACE: handled = this.handleReplaceMode(event); break;
	}

	if(handled) {
		event.preventDefault();
		return false;
	}
};

VimModePlugin.prototype.handleFocus = function() {
	if(this.enabled) this.updateUI();
};
VimModePlugin.prototype.handleBlur = function() {};

// -------- helpers (undo-safe DOM mutation) --------

VimModePlugin.prototype._mutate = function(mutator, forceSeparateUndo) {
	var engine = this.engine;
	engine.captureBeforeState();
	mutator();
	engine.syncCursorFromDOM();
	engine.recordUndo(!!forceSeparateUndo);
	engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

// -------- modes --------

VimModePlugin.prototype.handleNormalMode = function(event) {
	var key = event.key;
	var dominated = event.ctrlKey || event.metaKey;

	// Build count
	if(/^[1-9]$/.test(key) && this.commandBuffer === "") {
		this.repeatCount = this.repeatCount * 10 + parseInt(key, 10);
		return true;
	}
	if(key === "0" && this.repeatCount > 0) {
		this.repeatCount = this.repeatCount * 10;
		return true;
	}

	var hadCount = this.repeatCount > 0;
	var count = this.repeatCount || 1;
	this.repeatCount = 0;

	// Operator pending
	if(this.commandBuffer) return this.handleOperatorPending(key, count);

	// Movement
	switch(key) {
		case "h": this.moveCursor(-count); return true;
		case "l": this.moveCursor(count); return true;
		case "j": this.moveLines(count); return true;
		case "k": this.moveLines(-count); return true;
		case "w": this.moveWord(count, false); return true;
		case "W": this.moveWord(count, true); return true;
		case "b": this.moveWordBack(count, false); return true;
		case "B": this.moveWordBack(count, true); return true;
		case "e": this.moveWordEnd(count, false); return true;
		case "E": this.moveWordEnd(count, true); return true;
		case "0": this.moveToLineStart(); return true;
		case "$": this.moveToLineEnd(); return true;
		case "^": this.moveToFirstNonBlank(); return true;
		case "G":
			if(!hadCount) this.moveToEnd();
			else this.moveToLine(count);
			return true;
		case "g":
		case "f":
		case "F":
		case "t":
		case "T":
		case "r":
		case "m":
		case "'":
		case "`":
			this.commandBuffer = key;
			return true;
	}

	// Mode changes
	switch(key) {
		case "i": this.enterInsertMode(); return true;
		case "I": this.moveToFirstNonBlank(); this.enterInsertMode(); return true;
		case "a": this.moveCursor(1); this.enterInsertMode(); return true;
		case "A": this.moveToLineEnd(); this.enterInsertMode(); return true;
		case "o": this.openLineBelow(); this.enterInsertMode(); return true;
		case "O": this.openLineAbove(); this.enterInsertMode(); return true;
		case "v": this.enterVisualMode(); return true;
		case "V": this.enterVisualLineMode(); return true;
		case ":": this.enterCommandMode(); return true;
		case "R": this.enterReplaceMode(); return true;
	}

	// Edits
	switch(key) {
		case "x": this.deleteChar(count); this.recordCommand({type:"x",count:count}); return true;
		case "X": this.deleteCharBack(count); return true;
		case "d": this.commandBuffer = "d"; this.operatorCount = count; return true;
		case "D": this.deleteToLineEnd(); return true;
		case "c": this.commandBuffer = "c"; this.operatorCount = count; return true;
		case "C": this.deleteToLineEnd(); this.enterInsertMode(); return true;
		case "y": this.commandBuffer = "y"; this.operatorCount = count; return true;
		case "Y": this.yankLine(count); return true;
		case "p": this.paste(false, count); return true;
		case "P": this.paste(true, count); return true;
		case "u": this.engine.undo(); return true;
		case ".": this.repeatLastCommand(); return true;
	}

	// Ctrl bindings (subset)
	if(dominated) {
		switch(String(key).toLowerCase()) {
			case "r": this.engine.redo(); return true;
			case "f": this.pageDown(); return true;
			case "b": this.pageUp(); return true;
			case "d": this.halfPageDown(); return true;
			case "u": this.halfPageUp(); return true;
		}
	}

	// Search
	switch(key) {
		case "/": this.startSearch(1); return true;
		case "?": this.startSearch(-1); return true;
		case "n": this.repeatSearch(1); return true;
		case "N": this.repeatSearch(-1); return true;
		case "*": this.searchWordUnderCursor(1); return true;
		case "#": this.searchWordUnderCursor(-1); return true;
	}

	return false;
};

VimModePlugin.prototype.handleOperatorPending = function(key, count) {
	var operator = this.commandBuffer;
	this.commandBuffer = "";
	var opCount = this.operatorCount || 1;
	this.operatorCount = 0;

	// g commands (minimal)
	if(operator === "g") {
		if(key === "g") { this.moveToLine(count); return true; }
		return false;
	}

	// Find-char motions
	if(operator === "f" || operator === "F" || operator === "t" || operator === "T") {
		this.findChar(key, operator);
		return true;
	}

	// Replace char under cursor (normal mode)
	if(operator === "r") {
		this.replaceCharUnderCursor(key);
		return true;
	}

	// Marks
	if(operator === "m") { this.setMark(key); return true; }
	if(operator === "'" || operator === "`") { this.gotoMark(key, operator === "'"); return true; }

	// dd/cc/yy
	if(key === operator && (operator === "d" || operator === "c" || operator === "y")) {
		if(operator === "d") { this.deleteLine(opCount * count); this.recordCommand({type:"dd",count:opCount*count}); return true; }
		if(operator === "c") { this.changeLine(opCount * count); return true; }
		if(operator === "y") { this.yankLine(opCount * count); return true; }
	}

	// Motions (subset)
	switch(key) {
		case "w": this.applyOperatorMotion(operator, "word", opCount * count); return true;
		case "e": this.applyOperatorMotion(operator, "wordEnd", opCount * count); return true;
		case "b": this.applyOperatorMotion(operator, "wordBack", opCount * count); return true;
		case "$": this.applyOperatorMotion(operator, "lineEnd", 1); return true;
		case "0": this.applyOperatorMotion(operator, "lineStart", 1); return true;
		case "^": this.applyOperatorMotion(operator, "firstNonBlank", 1); return true;
	}

	return false;
};

VimModePlugin.prototype.handleInsertMode = function(event) {
	var dominated = event.ctrlKey || event.metaKey;
	if(dominated) {
		switch(String(event.key).toLowerCase()) {
			case "w": this.deleteWordBack(); return true;
			case "u": this.deleteToLineStart(); return true;
		}
	}
	// Let browser input happen
	return false;
};

VimModePlugin.prototype.handleVisualMode = function(event) {
	var key = event.key;

	// Basic movement extends selection
	switch(key) {
		case "h": this.extendSelection(-1); return true;
		case "l": this.extendSelection(1); return true;
		case "j": this.extendSelectionLines(1); return true;
		case "k": this.extendSelectionLines(-1); return true;
		case "0": this.extendSelectionToLineStart(); return true;
		case "$": this.extendSelectionToLineEnd(); return true;
		case "G": this.extendSelectionToEnd(); return true;
	}

	// Ops
	switch(key) {
		case "d":
		case "x": this.deleteSelection(); this.enterNormalMode(); return true;
		case "y": this.yankSelection(); this.enterNormalMode(); return true;
		case "c":
		case "s": this.deleteSelection(); this.enterInsertMode(); return true;
	}

	return false;
};

VimModePlugin.prototype.handleCommandMode = function(event) {
	var key = event.key;

	if(key === "Enter") {
		this.executeCommand(this.commandBuffer);
		this.commandBuffer = "";
		this.enterNormalMode();
		return true;
	}

	if(key === "Backspace") {
		this.commandBuffer = this.commandBuffer.slice(0, -1);
		if(this.commandBuffer === "") this.enterNormalMode();
		else this.updateCommandLine();
		return true;
	}

	if(key.length === 1) {
		this.commandBuffer += key;
		this.updateCommandLine();
		return true;
	}

	// Eat everything else in command mode (simple model)
	this.updateCommandLine();
	return true;
};

VimModePlugin.prototype.handleReplaceMode = function(event) {
	var key = event.key;

	if(key.length === 1) { this.replaceAndAdvance(key); return true; }
	if(key === "Backspace") { this.moveCursor(-1); return true; }
	return false;
};

// -------- transitions --------

VimModePlugin.prototype.enterNormalMode = function() {
	var domNode = this.engine.domNode;

	if(this.mode === MODES.INSERT) {
		var insertedText = domNode.value.substring(this.insertStartPos, domNode.selectionStart);
		if(insertedText) this.recordCommand({ type:"insert", text: insertedText });

		// Vim behavior: move cursor back one (if possible)
		if(domNode.selectionStart > 0) {
			domNode.setSelectionRange(domNode.selectionStart - 1, domNode.selectionStart - 1);
			this.engine.syncCursorFromDOM();
		}
	}

	this.mode = MODES.NORMAL;
	this.commandBuffer = "";
	this.repeatCount = 0;
	this.operatorCount = 0;
	this.updateUI();
};

VimModePlugin.prototype.enterInsertMode = function() {
	this.mode = MODES.INSERT;
	this.insertStartPos = this.engine.domNode.selectionStart;
	this.updateUI();
};

VimModePlugin.prototype.enterVisualMode = function() {
	this.mode = MODES.VISUAL;
	this.visualStart = this.engine.domNode.selectionStart;
	this.updateUI();
};

VimModePlugin.prototype.enterVisualLineMode = function() {
	this.mode = MODES.VISUAL_LINE;
	var info = this.engine.getLineInfo(this.engine.domNode.selectionStart);
	this.visualStart = info.lineStart;
	this.selectCurrentLine();
	this.updateUI();
};

VimModePlugin.prototype.enterCommandMode = function() {
	this.mode = MODES.COMMAND;
	this.commandBuffer = ":";
	this.showCommandLine();
	this.updateUI();
};

VimModePlugin.prototype.enterReplaceMode = function() {
	this.mode = MODES.REPLACE;
	this.updateUI();
};

// -------- movement --------

VimModePlugin.prototype.moveCursor = function(delta) {
	var domNode = this.engine.domNode;
	var newPos = Math.max(0, Math.min(domNode.value.length, domNode.selectionStart + delta));
	domNode.setSelectionRange(newPos, newPos);
	this.engine.syncCursorFromDOM();
	this.updateBlockCursor();
};

VimModePlugin.prototype.moveLines = function(delta) {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var pos = domNode.selectionStart;
	var info = this.engine.getLineInfo(pos);

	var lines = text.split("\n");
	var targetLine = Math.max(0, Math.min(lines.length - 1, info.line + delta));
	var targetCol = Math.min(info.column, lines[targetLine].length);
	var newPos = this.engine.getPositionForLineColumn(targetLine, targetCol);

	domNode.setSelectionRange(newPos, newPos);
	this.engine.syncCursorFromDOM();
	this.updateBlockCursor();
};

VimModePlugin.prototype.moveWord = function(count, bigWord) {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var pos = domNode.selectionStart;
	var wordRegex = bigWord ? /\S/ : /\w/;

	for(var i = 0; i < count; i++) {
		while(pos < text.length && wordRegex.test(text[pos])) pos++;
		while(pos < text.length && !wordRegex.test(text[pos])) pos++;
	}

	domNode.setSelectionRange(pos, pos);
	this.engine.syncCursorFromDOM();
	this.updateBlockCursor();
};

VimModePlugin.prototype.moveWordBack = function(count, bigWord) {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var pos = domNode.selectionStart;
	var wordRegex = bigWord ? /\S/ : /\w/;

	for(var i = 0; i < count; i++) {
		if(pos > 0) pos--;
		while(pos > 0 && !wordRegex.test(text[pos])) pos--;
		while(pos > 0 && wordRegex.test(text[pos - 1])) pos--;
	}

	domNode.setSelectionRange(pos, pos);
	this.engine.syncCursorFromDOM();
	this.updateBlockCursor();
};

VimModePlugin.prototype.moveWordEnd = function(count, bigWord) {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var pos = domNode.selectionStart;
	var wordRegex = bigWord ? /\S/ : /\w/;

	for(var i = 0; i < count; i++) {
		if(pos < text.length) pos++;
		while(pos < text.length && !wordRegex.test(text[pos])) pos++;
		while(pos < text.length - 1 && wordRegex.test(text[pos + 1])) pos++;
	}

	domNode.setSelectionRange(pos, pos);
	this.engine.syncCursorFromDOM();
	this.updateBlockCursor();
};

VimModePlugin.prototype.moveToLineStart = function() {
	var domNode = this.engine.domNode;
	var info = this.engine.getLineInfo(domNode.selectionStart);
	domNode.setSelectionRange(info.lineStart, info.lineStart);
	this.engine.syncCursorFromDOM();
	this.updateBlockCursor();
};

VimModePlugin.prototype.moveToLineEnd = function() {
	var domNode = this.engine.domNode;
	var info = this.engine.getLineInfo(domNode.selectionStart);
	var endPos = info.lineStart + info.lineText.length;
	domNode.setSelectionRange(endPos, endPos);
	this.engine.syncCursorFromDOM();
	this.updateBlockCursor();
};

VimModePlugin.prototype.moveToFirstNonBlank = function() {
	var domNode = this.engine.domNode;
	var info = this.engine.getLineInfo(domNode.selectionStart);
	var m = info.lineText.match(/^\s*/);
	var offset = m ? m[0].length : 0;
	var newPos = info.lineStart + offset;
	domNode.setSelectionRange(newPos, newPos);
	this.engine.syncCursorFromDOM();
	this.updateBlockCursor();
};

VimModePlugin.prototype.moveToLine = function(lineNum) {
	var domNode = this.engine.domNode;
	var lines = domNode.value.split("\n");
	var targetLine = Math.max(0, Math.min(lines.length - 1, lineNum - 1));
	var newPos = this.engine.getPositionForLineColumn(targetLine, 0);
	domNode.setSelectionRange(newPos, newPos);
	this.moveToFirstNonBlank();
};

VimModePlugin.prototype.moveToEnd = function() {
	var domNode = this.engine.domNode;
	var lines = domNode.value.split("\n");
	var last = Math.max(0, lines.length - 1);
	var newPos = this.engine.getPositionForLineColumn(last, 0);
	domNode.setSelectionRange(newPos, newPos);
	this.moveToFirstNonBlank();
};

VimModePlugin.prototype.findChar = function(char, mode) {
	var domNode = this.engine.domNode;
	var pos = domNode.selectionStart;
	var info = this.engine.getLineInfo(pos);
	var line = info.lineText;
	var col = info.column;

	var idx = -1;
	if(mode === "f" || mode === "t") {
		idx = line.indexOf(char, col + 1);
		if(idx !== -1) {
			if(mode === "t") idx = Math.max(0, idx - 1);
			domNode.setSelectionRange(info.lineStart + idx, info.lineStart + idx);
		}
	} else {
		idx = line.lastIndexOf(char, col - 1);
		if(idx !== -1) {
			if(mode === "T") idx = Math.min(line.length, idx + 1);
			domNode.setSelectionRange(info.lineStart + idx, info.lineStart + idx);
		}
	}
	this.engine.syncCursorFromDOM();
	this.updateBlockCursor();
};

// -------- edits (all undo-safe) --------

VimModePlugin.prototype._setRegister = function(name, text, isLine) {
	this.registers[name] = { text: text || "", isLine: !!isLine };
};

VimModePlugin.prototype.deleteChar = function(count) {
	var self = this;
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var pos = domNode.selectionStart;
	var end = Math.min(text.length, pos + count);

	this._setRegister('"', text.substring(pos, end), false);
	this._setRegister('-', this.registers['"'].text, false);

	this._mutate(function() {
		domNode.value = text.substring(0, pos) + text.substring(end);
		domNode.setSelectionRange(pos, pos);
	}, true);

	this.updateBlockCursor();
};

VimModePlugin.prototype.deleteCharBack = function(count) {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var pos = domNode.selectionStart;
	var start = Math.max(0, pos - count);

	this._setRegister('"', text.substring(start, pos), false);
	this._setRegister('-', this.registers['"'].text, false);

	this._mutate(function() {
		domNode.value = text.substring(0, start) + text.substring(pos);
		domNode.setSelectionRange(start, start);
	}, true);

	this.updateBlockCursor();
};

VimModePlugin.prototype.deleteLine = function(count) {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var pos = domNode.selectionStart;
	var info = this.engine.getLineInfo(pos);

	var lines = text.split("\n");
	var startLine = info.line;
	var endLine = Math.min(lines.length - 1, startLine + count - 1);

	var lineStart = this.engine.getPositionForLineColumn(startLine, 0);
	var lineEnd = this.engine.getPositionForLineColumn(endLine, lines[endLine].length);
	if(endLine < lines.length - 1) lineEnd++; // include newline

	var deleted = text.substring(lineStart, lineEnd);
	this._setRegister('"', deleted, true);
	this._setRegister('0', deleted, true);

	this._mutate(function() {
		domNode.value = text.substring(0, lineStart) + text.substring(lineEnd);
		domNode.setSelectionRange(lineStart, lineStart);
	}, true);

	this.moveToFirstNonBlank();
};

VimModePlugin.prototype.changeLine = function(count) {
	// Simple: delete whole line(s) and enter insert
	this.deleteLine(count);
	this.enterInsertMode();
};

VimModePlugin.prototype.deleteToLineEnd = function() {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var pos = domNode.selectionStart;
	var info = this.engine.getLineInfo(pos);
	var endPos = info.lineStart + info.lineText.length;

	this._setRegister('"', text.substring(pos, endPos), false);

	this._mutate(function() {
		domNode.value = text.substring(0, pos) + text.substring(endPos);
		domNode.setSelectionRange(pos, pos);
	}, true);

	this.updateBlockCursor();
};

VimModePlugin.prototype.yankLine = function(count) {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var info = this.engine.getLineInfo(domNode.selectionStart);

	var lines = text.split("\n");
	var startLine = info.line;
	var endLine = Math.min(lines.length - 1, startLine + count - 1);

	var yanked = lines.slice(startLine, endLine + 1).join("\n") + "\n";
	this._setRegister('"', yanked, true);
	this._setRegister('0', yanked, true);

	this.showMessage(count + " line" + (count > 1 ? "s" : "") + " yanked");
};

VimModePlugin.prototype.paste = function(before, count) {
	var reg = this.registers['"'] || {text:"",isLine:false};
	var content = reg.text;
	if(!content) return;

	var domNode = this.engine.domNode;
	var text = domNode.value;
	var pos = domNode.selectionStart;
	var insertPos = pos;

	var repeated = "";
	for(var i = 0; i < count; i++) repeated += content;

	var self = this;
	this._mutate(function() {
		if(reg.isLine) {
			var info = self.engine.getLineInfo(pos);
			if(before) insertPos = info.lineStart;
			else {
				insertPos = info.lineStart + info.lineText.length;
				if(insertPos < text.length) insertPos++; // after newline
			}
			if(!repeated.endsWith("\n")) repeated += "\n";
			domNode.value = text.substring(0, insertPos) + repeated + text.substring(insertPos);
			domNode.setSelectionRange(insertPos, insertPos);
			self.moveToFirstNonBlank();
		} else {
			insertPos = before ? pos : Math.min(text.length, pos + 1);
			domNode.value = text.substring(0, insertPos) + repeated + text.substring(insertPos);
			var caret = insertPos + repeated.length - 1;
			caret = Math.max(0, Math.min(domNode.value.length, caret));
			domNode.setSelectionRange(caret, caret);
		}
	}, true);

	this.updateBlockCursor();
};

VimModePlugin.prototype.openLineBelow = function() {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var info = this.engine.getLineInfo(domNode.selectionStart);
	var endPos = info.lineStart + info.lineText.length;
	var indent = (info.lineText.match(/^\s*/) || [""])[0];

	this._mutate(function() {
		domNode.value = text.substring(0, endPos) + "\n" + indent + text.substring(endPos);
		var caret = endPos + 1 + indent.length;
		domNode.setSelectionRange(caret, caret);
	}, true);
};

VimModePlugin.prototype.openLineAbove = function() {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var info = this.engine.getLineInfo(domNode.selectionStart);
	var indent = (info.lineText.match(/^\s*/) || [""])[0];

	this._mutate(function() {
		domNode.value = text.substring(0, info.lineStart) + indent + "\n" + text.substring(info.lineStart);
		var caret = info.lineStart + indent.length;
		domNode.setSelectionRange(caret, caret);
	}, true);
};

VimModePlugin.prototype.replaceCharUnderCursor = function(char) {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var pos = domNode.selectionStart;
	if(pos >= text.length || text[pos] === "\n") return;

	this._mutate(function() {
		domNode.value = text.substring(0, pos) + char + text.substring(pos + 1);
		domNode.setSelectionRange(pos, pos);
	}, true);

	this.recordCommand({ type:"replace", char: char });
	this.updateBlockCursor();
};

VimModePlugin.prototype.replaceAndAdvance = function(char) {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var pos = domNode.selectionStart;

	if(pos >= text.length || text[pos] === "\n") {
		this.enterNormalMode();
		return;
	}

	this._mutate(function() {
		domNode.value = text.substring(0, pos) + char + text.substring(pos + 1);
		domNode.setSelectionRange(pos + 1, pos + 1);
	}, true);

	this.updateBlockCursor();
};

// -------- visual operations --------

VimModePlugin.prototype.extendSelection = function(delta) {
	var domNode = this.engine.domNode;
	var newEnd = Math.max(0, Math.min(domNode.value.length, domNode.selectionEnd + delta));

	if(newEnd >= this.visualStart) domNode.setSelectionRange(this.visualStart, newEnd);
	else domNode.setSelectionRange(newEnd, this.visualStart);

	this.engine.syncCursorFromDOM();
	this.updateBlockCursor();
};

VimModePlugin.prototype.extendSelectionLines = function(delta) {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var currentEnd = domNode.selectionEnd;
	var info = this.engine.getLineInfo(currentEnd);
	var lines = text.split("\n");

	var targetLine = Math.max(0, Math.min(lines.length - 1, info.line + delta));
	var targetCol = Math.min(info.column, lines[targetLine].length);
	var newEnd = this.engine.getPositionForLineColumn(targetLine, targetCol);

	if(newEnd >= this.visualStart) domNode.setSelectionRange(this.visualStart, newEnd);
	else domNode.setSelectionRange(newEnd, this.visualStart);

	this.engine.syncCursorFromDOM();
	this.updateBlockCursor();
};

VimModePlugin.prototype.extendSelectionToLineStart = function() {
	var domNode = this.engine.domNode;
	var info = this.engine.getLineInfo(domNode.selectionEnd);
	var newEnd = info.lineStart;
	if(newEnd >= this.visualStart) domNode.setSelectionRange(this.visualStart, newEnd);
	else domNode.setSelectionRange(newEnd, this.visualStart);
	this.engine.syncCursorFromDOM();
	this.updateBlockCursor();
};

VimModePlugin.prototype.extendSelectionToLineEnd = function() {
	var domNode = this.engine.domNode;
	var info = this.engine.getLineInfo(domNode.selectionEnd);
	var newEnd = info.lineStart + info.lineText.length;
	if(newEnd >= this.visualStart) domNode.setSelectionRange(this.visualStart, newEnd);
	else domNode.setSelectionRange(newEnd, this.visualStart);
	this.engine.syncCursorFromDOM();
	this.updateBlockCursor();
};

VimModePlugin.prototype.extendSelectionToEnd = function() {
	var domNode = this.engine.domNode;
	var newEnd = domNode.value.length;
	if(newEnd >= this.visualStart) domNode.setSelectionRange(this.visualStart, newEnd);
	else domNode.setSelectionRange(newEnd, this.visualStart);
	this.engine.syncCursorFromDOM();
	this.updateBlockCursor();
};

VimModePlugin.prototype.deleteSelection = function() {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var start = domNode.selectionStart;
	var end = domNode.selectionEnd;
	this._setRegister('"', text.substring(start, end), false);

	var self = this;
	this._mutate(function() {
		domNode.value = text.substring(0, start) + text.substring(end);
		domNode.setSelectionRange(start, start);
	}, true);

	self.updateBlockCursor();
};

VimModePlugin.prototype.yankSelection = function() {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var start = domNode.selectionStart;
	var end = domNode.selectionEnd;
	this._setRegister('"', text.substring(start, end), false);
	this._setRegister('0', this.registers['"'].text, false);

	// Collapse selection
	domNode.setSelectionRange(start, start);
	this.engine.syncCursorFromDOM();
	this.showMessage("Yanked " + (end - start) + " characters");
};

VimModePlugin.prototype.selectCurrentLine = function() {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var info = this.engine.getLineInfo(domNode.selectionStart);

	var start = info.lineStart;
	var end = info.lineStart + info.lineText.length;
	if(end < text.length && text[end] === "\n") end++;

	domNode.setSelectionRange(start, end);
	this.visualStart = start;
	this.engine.syncCursorFromDOM();
};

// -------- operator motions (subset) --------

VimModePlugin.prototype.applyOperatorMotion = function(operator, motion, count) {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var startPos = domNode.selectionStart;
	var endPos = startPos;

	switch(motion) {
		case "word":
			for(var i = 0; i < count; i++) {
				while(endPos < text.length && /\w/.test(text[endPos])) endPos++;
				while(endPos < text.length && !/\w/.test(text[endPos]) && text[endPos] !== "\n") endPos++;
			}
			break;
		case "wordEnd":
			for(i = 0; i < count; i++) {
				if(endPos < text.length) endPos++;
				while(endPos < text.length && !/\w/.test(text[endPos])) endPos++;
				while(endPos < text.length - 1 && /\w/.test(text[endPos + 1])) endPos++;
			}
			endPos = Math.min(text.length, endPos + 1);
			break;
		case "wordBack":
			for(i = 0; i < count; i++) {
				if(startPos > 0) startPos--;
				while(startPos > 0 && !/\w/.test(text[startPos])) startPos--;
				while(startPos > 0 && /\w/.test(text[startPos - 1])) startPos--;
			}
			endPos = domNode.selectionStart;
			break;
		case "lineEnd":
			var info = this.engine.getLineInfo(startPos);
			endPos = info.lineStart + info.lineText.length;
			break;
		case "lineStart":
			info = this.engine.getLineInfo(startPos);
			endPos = startPos;
			startPos = info.lineStart;
			break;
		case "firstNonBlank":
			info = this.engine.getLineInfo(startPos);
			var m = info.lineText.match(/^\s*/);
			endPos = startPos;
			startPos = info.lineStart + (m ? m[0].length : 0);
			break;
	}

	this.applyOperator(operator, startPos, endPos);
};

VimModePlugin.prototype.applyOperator = function(operator, start, end) {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var selected = text.substring(start, end);

	if(operator === "y") {
		this._setRegister('"', selected, false);
		this._setRegister('0', selected, false);
		domNode.setSelectionRange(start, start);
		this.engine.syncCursorFromDOM();
		this.showMessage("Yanked " + selected.length + " characters");
		this.updateBlockCursor();
		return;
	}

	var self = this;
	this._setRegister('"', selected, false);

	this._mutate(function() {
		domNode.value = text.substring(0, start) + text.substring(end);
		domNode.setSelectionRange(start, start);
	}, true);

	if(operator === "c") this.enterInsertMode();
	this.updateBlockCursor();
};

// -------- search (same behavior, safer minimal) --------

VimModePlugin.prototype.startSearch = function(direction) {
	this.searchDirection = direction;
	this.enterCommandMode();
	this.commandBuffer = direction === 1 ? "/" : "?";
	this.updateCommandLine();
};

VimModePlugin.prototype.repeatSearch = function(direction) {
	if(!this.lastSearch) return;
	var actual = this.searchDirection * direction;
	this.doSearch(this.lastSearch, actual);
};

VimModePlugin.prototype.searchWordUnderCursor = function(direction) {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var pos = domNode.selectionStart;

	var start = pos, end = pos;
	while(start > 0 && /\w/.test(text[start - 1])) start--;
	while(end < text.length && /\w/.test(text[end])) end++;

	var word = text.substring(start, end);
	if(!word) return;

	this.lastSearch = "\\b" + word + "\\b";
	this.searchDirection = direction;
	this.doSearch(this.lastSearch, direction);
};

VimModePlugin.prototype.doSearch = function(pattern, direction) {
	var domNode = this.engine.domNode;
	var text = domNode.value;
	var pos = domNode.selectionStart;

	try {
		var regex = new RegExp(pattern, "gi");
		var match, best = null;

		if(direction === 1) {
			regex.lastIndex = pos + 1;
			match = regex.exec(text);
			if(!match) {
				regex.lastIndex = 0;
				match = regex.exec(text);
			}
			if(match) best = { index: match.index, length: match[0].length };
		} else {
			// Backward: scan but keep last < pos
			while((match = regex.exec(text)) !== null) {
				if(match.index < pos) best = { index: match.index, length: match[0].length };
				else break;
			}
			if(!best) {
				// Wrap: find last match
				var last = null;
				regex.lastIndex = 0;
				while((match = regex.exec(text)) !== null) last = { index: match.index, length: match[0].length };
				best = last;
			}
		}

		if(!best) {
			this.showMessage("Pattern not found: " + pattern);
			return;
		}

		domNode.setSelectionRange(best.index, best.index);
		this.engine.syncCursorFromDOM();
		this.updateBlockCursor();
	} catch(e) {
		this.showMessage("Invalid pattern: " + pattern);
	}
};

// -------- marks --------

VimModePlugin.prototype.setMark = function(char) {
	if(!/[a-zA-Z]/.test(char)) return;
	this.marks[char] = this.engine.domNode.selectionStart;
	this.showMessage("Mark '" + char + "' set");
};

VimModePlugin.prototype.gotoMark = function(char, lineWise) {
	if(this.marks[char] === undefined) {
		this.showMessage("Mark '" + char + "' not set");
		return;
	}
	var pos = this.marks[char];
	this.engine.domNode.setSelectionRange(pos, pos);
	this.engine.syncCursorFromDOM();
	if(lineWise) this.moveToFirstNonBlank();
	this.updateBlockCursor();
};

// -------- command execution (minimal subset) --------

VimModePlugin.prototype.executeCommand = function(cmd) {
	var prefix = cmd[0];
	cmd = cmd.substring(1);

	if(prefix === "/" || prefix === "?") {
		this.lastSearch = cmd;
		this.doSearch(cmd, prefix === "/" ? 1 : -1);
		return;
	}

	if(cmd === "w") {
		this.engine.widget.dispatchEvent({ type: "tm-save-wiki" });
		this.showMessage("Saved");
		return;
	}
	if(cmd === "q") {
		this.engine.widget.dispatchEvent({ type: "tm-close-tiddler" });
		return;
	}
	if(cmd === "wq" || cmd === "x") {
		this.engine.widget.dispatchEvent({ type: "tm-save-wiki" });
		this.engine.widget.dispatchEvent({ type: "tm-close-tiddler" });
		return;
	}
	if(/^\d+$/.test(cmd)) {
		this.moveToLine(parseInt(cmd, 10));
		return;
	}

	this.showMessage("Unknown command: " + cmd);
};

// -------- repeat command --------

VimModePlugin.prototype.recordCommand = function(cmd) { this.lastCommand = cmd; };

VimModePlugin.prototype.repeatLastCommand = function() {
	if(!this.lastCommand) return;
	switch(this.lastCommand.type) {
		case "x": this.deleteChar(this.lastCommand.count); break;
		case "dd": this.deleteLine(this.lastCommand.count); break;
		case "insert": {
			var domNode = this.engine.domNode;
			var pos = domNode.selectionStart;
			var text = domNode.value;
			var insert = this.lastCommand.text || "";
			var self = this;
			this._mutate(function() {
				domNode.value = text.substring(0, pos) + insert + text.substring(pos);
				domNode.setSelectionRange(pos + insert.length, pos + insert.length);
			}, true);
			self.updateBlockCursor();
			break;
		}
		case "replace": this.replaceCharUnderCursor(this.lastCommand.char); break;
	}
};

// -------- UI --------

VimModePlugin.prototype.updateUI = function() {
	this.showModeIndicator();
	if(this.mode === MODES.NORMAL || this.mode === MODES.VISUAL || this.mode === MODES.VISUAL_LINE) this.showBlockCursor();
	else this.hideBlockCursor();

	if(this.mode !== MODES.COMMAND) this.hideCommandLine();
};

VimModePlugin.prototype.showModeIndicator = function() {
	if(!this.modeIndicator) return;

	var text = {
		[MODES.NORMAL]: "-- NORMAL --",
		[MODES.INSERT]: "-- INSERT --",
		[MODES.VISUAL]: "-- VISUAL --",
		[MODES.VISUAL_LINE]: "-- VISUAL LINE --",
		[MODES.COMMAND]: "",
		[MODES.REPLACE]: "-- REPLACE --"
	};
	this.modeIndicator.textContent = text[this.mode] || "";
	this.modeIndicator.style.display = (this.mode !== MODES.COMMAND) ? "block" : "none";

	var colors = {
		[MODES.NORMAL]: "#4a9",
		[MODES.INSERT]: "#49a",
		[MODES.VISUAL]: "#a94",
		[MODES.VISUAL_LINE]: "#a94",
		[MODES.REPLACE]: "#a49"
	};
	this.modeIndicator.style.background = colors[this.mode] || "#333";
};

VimModePlugin.prototype.hideModeIndicator = function() {
	if(this.modeIndicator) this.modeIndicator.style.display = "none";
};

VimModePlugin.prototype.showBlockCursor = function() {
	if(!this.blockCursor) return;
	this.engine.domNode.style.caretColor = "transparent";
	this.blockCursor.style.display = "block";
	this.updateBlockCursor();
};

VimModePlugin.prototype.hideBlockCursor = function() {
	if(this.blockCursor) this.blockCursor.style.display = "none";
	this.engine.domNode.style.caretColor = "";
};

VimModePlugin.prototype.updateBlockCursor = function() {
	if(!this.blockCursor) return;
	if(this.mode === MODES.INSERT || this.mode === MODES.COMMAND) return;

	var pos = this.engine.domNode.selectionStart;
	var coords = this.engine.getCoordinatesForPosition(pos);
	if(!coords) return;

	var w = this.engine.getWindow();
	var computed = w ? w.getComputedStyle(this.engine.domNode) : null;

	// Measure current char width (fallback to ~0.6em)
	var charWidth = this.getCharWidth(computed);

	var text = this.engine.domNode.value;
	var width = (pos < text.length && text[pos] !== "\n") ? charWidth : Math.max(2, charWidth * 0.5);

	this.blockCursor.style.left = coords.left + "px";
	this.blockCursor.style.top = coords.top + "px";
	this.blockCursor.style.width = width + "px";
	this.blockCursor.style.height = coords.height + "px";
};

VimModePlugin.prototype.getCharWidth = function(computedStyle) {
	var doc = this.engine.getDocument();
	var win = this.engine.getWindow();
	if(!doc || !win) return 8;

	var span = doc.createElement("span");
	span.style.visibility = "hidden";
	span.style.position = "absolute";
	span.style.whiteSpace = "pre";

	// Use iframe window computed style
	if(computedStyle && computedStyle.font) span.style.font = computedStyle.font;
	else span.style.font = win.getComputedStyle(this.engine.domNode).font;

	span.textContent = "M";
	doc.body.appendChild(span);
	var width = span.getBoundingClientRect().width || span.offsetWidth || 8;
	doc.body.removeChild(span);
	return width;
};

VimModePlugin.prototype.showCommandLine = function() {
	if(this.commandLine) {
		this.commandLine.style.display = "block";
		this.updateCommandLine();
	}
	if(this.modeIndicator) this.modeIndicator.style.display = "none";
};

VimModePlugin.prototype.hideCommandLine = function() {
	if(this.commandLine) this.commandLine.style.display = "none";
};

VimModePlugin.prototype.updateCommandLine = function() {
	if(this.commandLine) this.commandLine.textContent = this.commandBuffer + "â–ˆ";
};

VimModePlugin.prototype.showMessage = function(msg) {
	var self = this;
	if(!this.commandLine) return;

	this.commandLine.textContent = msg;
	this.commandLine.style.display = "block";

	setTimeout(function() {
		if(self.mode !== MODES.COMMAND) self.hideCommandLine();
	}, 2000);
};

// -------- safe fallbacks for ctrl motions used above --------

VimModePlugin.prototype.pageDown = function() { this._scrollByPages(1); };
VimModePlugin.prototype.pageUp = function() { this._scrollByPages(-1); };
VimModePlugin.prototype.halfPageDown = function() { this._scrollByPages(0.5); };
VimModePlugin.prototype.halfPageUp = function() { this._scrollByPages(-0.5); };

VimModePlugin.prototype._scrollByPages = function(mult) {
	var ta = this.engine.domNode;
	var lineHeight = this.engine.getCoordinatesForPosition(ta.selectionStart)?.height || 20;
	var lines = Math.floor((ta.clientHeight / lineHeight) * Math.abs(mult));
	var dir = mult < 0 ? -1 : 1;
	this.moveLines(dir * Math.max(1, lines));
	ta.scrollTop += dir * ta.clientHeight * Math.abs(mult);
};

// Insert-mode deletes (simple)
VimModePlugin.prototype.deleteWordBack = function() {
	var ta = this.engine.domNode;
	var pos = ta.selectionStart;
	if(pos === 0) return;

	var text = ta.value;
	var start = pos;

	while(start > 0 && /\s/.test(text[start - 1])) start--;
	while(start > 0 && /\w/.test(text[start - 1])) start--;

	var self = this;
	this._mutate(function() {
		ta.value = text.substring(0, start) + text.substring(pos);
		ta.setSelectionRange(start, start);
	}, true);
	self.updateBlockCursor();
};

VimModePlugin.prototype.deleteToLineStart = function() {
	var ta = this.engine.domNode;
	var pos = ta.selectionStart;
	var info = this.engine.getLineInfo(pos);
	var start = info.lineStart;
	var text = ta.value;

	var self = this;
	this._mutate(function() {
		ta.value = text.substring(0, start) + text.substring(pos);
		ta.setSelectionRange(start, start);
	}, true);
	self.updateBlockCursor();
};

VimModePlugin.prototype.destroy = function() {
	if(this.modeIndicator && this.modeIndicator.parentNode) this.modeIndicator.parentNode.removeChild(this.modeIndicator);
	if(this.commandLine && this.commandLine.parentNode) this.commandLine.parentNode.removeChild(this.commandLine);
	if(this.blockCursor && this.blockCursor.parentNode) this.blockCursor.parentNode.removeChild(this.blockCursor);
};