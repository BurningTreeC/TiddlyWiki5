/*\
title: $:/plugins/tiddlywiki/editor/jump-navigation/jump-navigation.js
type: application/javascript
module-type: editor-plugin

Enhanced jump navigation with:
- Go to line dialog (Ctrl+G)
- Go to symbol/heading (Ctrl+Shift+O)
- Jump to matching bracket (Ctrl+Shift+\)
- Edit history navigation (Ctrl+Alt+Left/Right)
- Breadcrumb trail showing current location
- Open link under cursor (Alt+Enter)
- Jump to definition (for macros)
- Quick outline navigation

\*/

"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "jump-navigation";
exports.configTiddler = "$:/config/Editor/EnableJumpNavigation";
exports.defaultEnabled = true;
exports.description = "Enhanced navigation with go-to-line, symbols, and brackets";
exports.category = "navigation";
exports.supports = { simple: false, framed: true };

exports.create = function(engine) { return new JumpNavigationPlugin(engine); };

// ==================== PLUGIN IMPLEMENTATION ====================

function JumpNavigationPlugin(engine) {
	this.engine = engine;
	this.name = "jump-navigation";
	this.enabled = false;

	// Edit history for jump back/forward
	this.history = [];
	this.historyIndex = -1;
	this.maxHistory = 100;
	this.lastPosition = -1;

	// UI elements
	this.dialog = null;
	this.symbolList = null;
	this.breadcrumb = null;
	this.styleEl = null;

	// Dialog state
	this.dialogMode = null; // "line", "symbol", "definition"
	this.symbols = [];
	this.filteredSymbols = [];
	this.selectedIndex = 0;

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this),
		selectionChange: this.onSelectionChange.bind(this),
		focus: this.onFocus.bind(this),
		render: this.onRender.bind(this)
	};
}

// ==================== LIFECYCLE ====================

JumpNavigationPlugin.prototype.enable = function() {
	this.enabled = true;
	this.injectStyles();
	this.createBreadcrumb();
};

JumpNavigationPlugin.prototype.disable = function() {
	this.enabled = false;
	this.closeDialog();
	this.removeBreadcrumb();
	this.removeStyles();
	this.history = [];
	this.historyIndex = -1;
};

JumpNavigationPlugin.prototype.destroy = function() {
	this.disable();
};

// ==================== HELPER METHODS ====================

JumpNavigationPlugin.prototype.getParentDocument = function() {
	// Get the parent document (where the wrapper lives)
	if(this.engine.widget && this.engine.widget.document) {
		return this.engine.widget.document;
	}
	return this.engine.getDocument();
};

JumpNavigationPlugin.prototype.getParentWindow = function() {
	var doc = this.getParentDocument();
	return doc && (doc.defaultView || window);
};

// ==================== STYLES ====================

JumpNavigationPlugin.prototype.injectStyles = function() {
	if(this.styleEl) return;

	// Dialog styles go in parent document (where dialog is rendered)
	var parentDoc = this.getParentDocument();
	// Breadcrumb/iframe styles go in iframe document
	var iframeDoc = this.engine.getDocument();
	
	if(!parentDoc) return;

	// Inject dialog styles in parent document
	this.styleEl = parentDoc.createElement("style");
	this.styleEl.textContent = [
		// Dialog styles
		".tc-jump-dialog {",
		"  position: absolute;",
		"  top: 50px;",
		"  left: 50%;",
		"  transform: translateX(-50%);",
		"  width: 400px;",
		"  max-width: 90%;",
		"  background: var(--tc-jump-bg, #fff);",
		"  border: 1px solid var(--tc-jump-border, #ddd);",
		"  border-radius: 8px;",
		"  box-shadow: 0 8px 32px rgba(0,0,0,0.2);",
		"  z-index: 100;",
		"  font-family: inherit;",
		"  overflow: hidden;",
		"}",

		".tc-jump-header {",
		"  padding: 12px 16px;",
		"  background: var(--tc-jump-header-bg, #f8f9fa);",
		"  border-bottom: 1px solid var(--tc-jump-border, #ddd);",
		"  font-size: 12px;",
		"  color: var(--tc-jump-header-fg, #666);",
		"}",

		".tc-jump-input {",
		"  width: 100%;",
		"  padding: 12px 16px;",
		"  border: none;",
		"  outline: none;",
		"  font-size: 14px;",
		"  font-family: inherit;",
		"  box-sizing: border-box;",
		"  background: transparent;",
		"}",
		".tc-jump-input::placeholder {",
		"  color: var(--tc-jump-placeholder, #999);",
		"}",

		".tc-jump-list {",
		"  max-height: 300px;",
		"  overflow-y: auto;",
		"  border-top: 1px solid var(--tc-jump-border, #eee);",
		"}",

		".tc-jump-item {",
		"  padding: 10px 16px;",
		"  cursor: pointer;",
		"  display: flex;",
		"  align-items: center;",
		"  gap: 10px;",
		"  border-bottom: 1px solid var(--tc-jump-item-border, #f0f0f0);",
		"}",
		".tc-jump-item:last-child {",
		"  border-bottom: none;",
		"}",
		".tc-jump-item:hover, .tc-jump-item.selected {",
		"  background: var(--tc-jump-item-hover, #f0f7ff);",
		"}",

		".tc-jump-icon {",
		"  flex: 0 0 auto;",
		"  width: 20px;",
		"  text-align: center;",
		"  color: var(--tc-jump-icon, #666);",
		"}",
		".tc-jump-icon.heading { color: var(--tc-jump-heading, #0066cc); }",
		".tc-jump-icon.macro { color: var(--tc-jump-macro, #008000); }",
		".tc-jump-icon.link { color: var(--tc-jump-link, #9900cc); }",
		".tc-jump-icon.code { color: var(--tc-jump-code, #cc6600); }",

		".tc-jump-content {",
		"  flex: 1;",
		"  min-width: 0;",
		"  overflow: hidden;",
		"  text-overflow: ellipsis;",
		"  white-space: nowrap;",
		"}",

		".tc-jump-line {",
		"  flex: 0 0 auto;",
		"  font-size: 11px;",
		"  color: var(--tc-jump-line-fg, #888);",
		"}",

		".tc-jump-footer {",
		"  padding: 8px 16px;",
		"  background: var(--tc-jump-footer-bg, #f8f9fa);",
		"  border-top: 1px solid var(--tc-jump-border, #ddd);",
		"  font-size: 11px;",
		"  color: var(--tc-jump-footer-fg, #888);",
		"}",

	].join("\n");

	(parentDoc.head || parentDoc.documentElement).appendChild(this.styleEl);

	// Breadcrumb styles go in iframe document (breadcrumb is in decoration layer)
	if(iframeDoc && iframeDoc !== parentDoc) {
		this.iframeStyleEl = iframeDoc.createElement("style");
		this.iframeStyleEl.textContent = [
			".tc-jump-breadcrumb {",
			"  position: absolute;",
			"  top: 4px;",
			"  left: 60px;",
			"  padding: 4px 10px;",
			"  font-size: 11px;",
			"  font-family: inherit;",
			"  background: var(--tc-breadcrumb-bg, rgba(0,0,0,0.05));",
			"  color: var(--tc-breadcrumb-fg, #666);",
			"  border-radius: 4px;",
			"  z-index: 15;",
			"  max-width: 60%;",
			"  overflow: hidden;",
			"  text-overflow: ellipsis;",
			"  white-space: nowrap;",
			"  pointer-events: none;",
			"}"
		].join("\n");
		(iframeDoc.head || iframeDoc.documentElement).appendChild(this.iframeStyleEl);
	}
};

JumpNavigationPlugin.prototype.removeStyles = function() {
	if(this.styleEl && this.styleEl.parentNode) {
		this.styleEl.parentNode.removeChild(this.styleEl);
	}
	this.styleEl = null;
};

// ==================== EVENT HOOKS ====================

JumpNavigationPlugin.prototype.onFocus = function() {
	this.history = [];
	this.historyIndex = -1;
	this.lastPosition = -1;
};

JumpNavigationPlugin.prototype.onRender = function() {
	if(this.breadcrumb) {
		this.updateBreadcrumb();
	}
};

JumpNavigationPlugin.prototype.onSelectionChange = function() {
	if(!this.enabled) return;

	var ta = this.engine.domNode;
	var pos = ta.selectionStart;

	// Track position changes for history
	if(Math.abs(pos - this.lastPosition) > 50) {
		this.addToHistory(this.lastPosition);
	}
	this.lastPosition = pos;

	// Update breadcrumb
	this.updateBreadcrumb();
};

JumpNavigationPlugin.prototype.onKeydown = function(event) {
	if(!this.enabled) return;

	var ctrl = event.ctrlKey || event.metaKey;

	// Dialog is open
	if(this.dialog) {
		return this.handleDialogKeydown(event);
	}

	// Ctrl+G: Go to line
	if(ctrl && !event.shiftKey && !event.altKey && (event.key === "g" || event.key === "G")) {
		event.preventDefault();
		this.openDialog("line");
		return false;
	}

	// Ctrl+Shift+O: Go to symbol
	if(ctrl && event.shiftKey && !event.altKey && (event.key === "o" || event.key === "O")) {
		event.preventDefault();
		this.openDialog("symbol");
		return false;
	}

	// Ctrl+Shift+\: Jump to matching bracket
	if(ctrl && event.shiftKey && event.key === "\\") {
		event.preventDefault();
		this.jumpToMatchingBracket();
		return false;
	}

	// Ctrl+Alt+Left/Right: Edit history navigation
	if(ctrl && event.altKey && !event.shiftKey) {
		if(event.key === "ArrowLeft") {
			event.preventDefault();
			this.jumpHistory(-1);
			return false;
		}
		if(event.key === "ArrowRight") {
			event.preventDefault();
			this.jumpHistory(1);
			return false;
		}
	}

	// Alt+[/]: Jump to matching bracket (alternative)
	if(event.altKey && !ctrl && !event.shiftKey) {
		if(event.key === "[" || event.key === "]") {
			event.preventDefault();
			this.jumpToMatchingBracket();
			return false;
		}
	}

	// Alt+Enter: Open link under cursor
	if(event.altKey && !ctrl && !event.shiftKey && event.key === "Enter") {
		event.preventDefault();
		this.openLinkUnderCursor();
		return false;
	}
};

// ==================== COMMANDS (for command palette) ====================

JumpNavigationPlugin.prototype.getCommands = function() {
	var self = this;
	return [
		{
			name: "Go to Line",
			shortcut: "Ctrl+G",
			category: "Navigation",
			run: function() { self.openDialog("line"); }
		},
		{
			name: "Go to Symbol",
			shortcut: "Ctrl+Shift+O",
			category: "Navigation",
			run: function() { self.openDialog("symbol"); }
		},
		{
			name: "Jump to Matching Bracket",
			shortcut: "Ctrl+Shift+\\",
			category: "Navigation",
			run: function() { self.jumpToMatchingBracket(); }
		},
		{
			name: "Jump Back",
			shortcut: "Ctrl+Alt+Left",
			category: "Navigation",
			run: function() { self.jumpHistory(-1); }
		},
		{
			name: "Jump Forward",
			shortcut: "Ctrl+Alt+Right",
			category: "Navigation",
			run: function() { self.jumpHistory(1); }
		},
		{
			name: "Open Link Under Cursor",
			shortcut: "Alt+Enter",
			category: "Navigation",
			run: function() { self.openLinkUnderCursor(); }
		}
	];
};

// ==================== DIALOG ====================

JumpNavigationPlugin.prototype.openDialog = function(mode) {
	if(this.dialog) this.closeDialog();

	this.dialogMode = mode;

	// Dialog must be in PARENT document (main TiddlyWiki page)
	var doc = this.getParentDocument();
	var wrapper = this.engine.getWrapperNode();
	if(!doc || !wrapper) return;

	this.dialog = doc.createElement("div");
	this.dialog.className = "tc-jump-dialog";

	// Header
	var header = doc.createElement("div");
	header.className = "tc-jump-header";

	if(mode === "line") {
		header.textContent = "Go to Line";
	} else if(mode === "symbol") {
		header.textContent = "Go to Symbol";
		this.collectSymbols();
	}

	this.dialog.appendChild(header);

	// Input
	this.input = doc.createElement("input");
	this.input.className = "tc-jump-input";
	this.input.type = "text";

	if(mode === "line") {
		var lineInfo = this.engine.getLineInfo(this.engine.domNode.selectionStart);
		this.input.placeholder = "Enter line number (current: " + (lineInfo.line + 1) + ")";
		this.input.value = "";
	} else if(mode === "symbol") {
		this.input.placeholder = "Type to filter symbols...";
		this.filteredSymbols = this.symbols.slice();
		this.selectedIndex = 0;
	}

	this.dialog.appendChild(this.input);

	// List (for symbol mode)
	if(mode === "symbol") {
		this.symbolList = doc.createElement("div");
		this.symbolList.className = "tc-jump-list";
		this.dialog.appendChild(this.symbolList);
		this.renderSymbolList();
	}

	// Footer with hints
	var footer = doc.createElement("div");
	footer.className = "tc-jump-footer";
	footer.textContent = "↵ confirm • Esc cancel";
	if(mode === "symbol") {
		footer.textContent = "↑↓ navigate • ↵ go • Esc cancel";
	}
	this.dialog.appendChild(footer);

	wrapper.appendChild(this.dialog);

	// Event listeners
	var self = this;
	this.input.addEventListener("input", function() {
		self.onDialogInput();
	});

	this.input.focus();
};

JumpNavigationPlugin.prototype.closeDialog = function() {
	if(this.dialog && this.dialog.parentNode) {
		this.dialog.parentNode.removeChild(this.dialog);
	}
	this.dialog = null;
	this.input = null;
	this.symbolList = null;
	this.dialogMode = null;
	this.symbols = [];
	this.filteredSymbols = [];
	this.selectedIndex = 0;

	// Refocus editor
	if(this.engine.domNode) {
		this.engine.domNode.focus();
	}
};

JumpNavigationPlugin.prototype.handleDialogKeydown = function(event) {
	if(event.key === "Escape") {
		event.preventDefault();
		this.closeDialog();
		return false;
	}

	if(event.key === "Enter") {
		event.preventDefault();
		this.executeDialogAction();
		return false;
	}

	if(this.dialogMode === "symbol") {
		if(event.key === "ArrowDown") {
			event.preventDefault();
			this.selectedIndex = Math.min(this.filteredSymbols.length - 1, this.selectedIndex + 1);
			this.renderSymbolList();
			return false;
		}
		if(event.key === "ArrowUp") {
			event.preventDefault();
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.renderSymbolList();
			return false;
		}
	}

	return true; // Let other keys through
};

JumpNavigationPlugin.prototype.onDialogInput = function() {
	if(this.dialogMode === "symbol") {
		var query = (this.input.value || "").toLowerCase();

		if(!query) {
			this.filteredSymbols = this.symbols.slice();
		} else {
			this.filteredSymbols = this.symbols.filter(function(s) {
				return s.text.toLowerCase().indexOf(query) !== -1;
			});
		}

		this.selectedIndex = 0;
		this.renderSymbolList();
	}
};

JumpNavigationPlugin.prototype.executeDialogAction = function() {
	if(this.dialogMode === "line") {
		var lineNum = parseInt(this.input.value, 10);
		if(!isNaN(lineNum) && lineNum > 0) {
			this.goToLine(lineNum);
		}
	} else if(this.dialogMode === "symbol") {
		if(this.filteredSymbols.length > 0 && this.selectedIndex < this.filteredSymbols.length) {
			var symbol = this.filteredSymbols[this.selectedIndex];
			this.goToPosition(symbol.position);
		}
	}

	this.closeDialog();
};

// ==================== SYMBOL COLLECTION ====================

JumpNavigationPlugin.prototype.collectSymbols = function() {
	var text = this.engine.domNode.value;
	var lines = text.split("\n");
	this.symbols = [];

	var pos = 0;
	for(var i = 0; i < lines.length; i++) {
		var line = lines[i];
		var lineStart = pos;

		// Headings
		var headingMatch = line.match(/^(!{1,6})\s+(.+)$/);
		if(headingMatch) {
			this.symbols.push({
				type: "heading",
				level: headingMatch[1].length,
				text: headingMatch[2],
				line: i,
				position: lineStart,
				icon: "H" + headingMatch[1].length
			});
		}

		// Macro definitions
		var macroMatch = line.match(/^\\define\s+(\w+)/);
		if(macroMatch) {
			this.symbols.push({
				type: "macro",
				text: macroMatch[1],
				line: i,
				position: lineStart,
				icon: "λ"
			});
		}

		// Procedure definitions
		var procMatch = line.match(/^\\procedure\s+(\w+)/);
		if(procMatch) {
			this.symbols.push({
				type: "procedure",
				text: procMatch[1],
				line: i,
				position: lineStart,
				icon: "ƒ"
			});
		}

		// Function definitions
		var funcMatch = line.match(/^\\function\s+(\S+)/);
		if(funcMatch) {
			this.symbols.push({
				type: "function",
				text: funcMatch[1],
				line: i,
				position: lineStart,
				icon: "ƒ"
			});
		}

		// Widget definitions
		var widgetMatch = line.match(/^\\widget\s+(\S+)/);
		if(widgetMatch) {
			this.symbols.push({
				type: "widget",
				text: widgetMatch[1],
				line: i,
				position: lineStart,
				icon: "◊"
			});
		}

		// Code blocks
		var codeMatch = line.match(/^```(\w*)$/);
		if(codeMatch) {
			this.symbols.push({
				type: "code",
				text: "Code block" + (codeMatch[1] ? " (" + codeMatch[1] + ")" : ""),
				line: i,
				position: lineStart,
				icon: "<>"
			});
		}

		pos += line.length + 1;
	}
};

JumpNavigationPlugin.prototype.renderSymbolList = function() {
	if(!this.symbolList) return;

	var doc = this.engine.getDocument();
	this.symbolList.innerHTML = "";

	if(this.filteredSymbols.length === 0) {
		var empty = doc.createElement("div");
		empty.className = "tc-jump-item";
		empty.textContent = "No symbols found";
		empty.style.color = "#888";
		empty.style.fontStyle = "italic";
		this.symbolList.appendChild(empty);
		return;
	}

	var self = this;
	for(var i = 0; i < this.filteredSymbols.length; i++) {
		var symbol = this.filteredSymbols[i];

		var item = doc.createElement("div");
		item.className = "tc-jump-item" + (i === this.selectedIndex ? " selected" : "");

		// Icon
		var icon = doc.createElement("div");
		icon.className = "tc-jump-icon " + symbol.type;
		icon.textContent = symbol.icon;
		item.appendChild(icon);

		// Content
		var content = doc.createElement("div");
		content.className = "tc-jump-content";

		// Add indent for heading levels
		if(symbol.type === "heading" && symbol.level > 1) {
			content.style.paddingLeft = ((symbol.level - 1) * 12) + "px";
		}

		content.textContent = symbol.text;
		item.appendChild(content);

		// Line number
		var lineNum = doc.createElement("div");
		lineNum.className = "tc-jump-line";
		lineNum.textContent = ":" + (symbol.line + 1);
		item.appendChild(lineNum);

		// Click handler
		(function(idx) {
			item.addEventListener("click", function() {
				self.selectedIndex = idx;
				self.executeDialogAction();
			});
		})(i);

		this.symbolList.appendChild(item);
	}

	// Scroll selected into view
	var selected = this.symbolList.querySelector(".selected");
	if(selected) {
		selected.scrollIntoView({ block: "nearest" });
	}
};

// ==================== NAVIGATION ====================

JumpNavigationPlugin.prototype.goToLine = function(lineNum) {
	var ta = this.engine.domNode;
	var text = ta.value;
	var lines = text.split("\n");

	lineNum = Math.max(1, Math.min(lineNum, lines.length));

	var pos = 0;
	for(var i = 0; i < lineNum - 1; i++) {
		pos += lines[i].length + 1;
	}

	this.addToHistory(ta.selectionStart);
	ta.selectionStart = pos;
	ta.selectionEnd = pos;
	this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();

	// Scroll into view
	this.scrollToPosition(pos);
};

JumpNavigationPlugin.prototype.goToPosition = function(pos) {
	var ta = this.engine.domNode;

	this.addToHistory(ta.selectionStart);
	ta.selectionStart = pos;
	ta.selectionEnd = pos;
	this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();

	this.scrollToPosition(pos);
};

JumpNavigationPlugin.prototype.scrollToPosition = function(pos) {
	var ta = this.engine.domNode;

	if(this.engine.getCoordinatesForPosition) {
		var coords = this.engine.getCoordinatesForPosition(pos);
		if(coords) {
			var scrollTop = ta.scrollTop;
			var viewHeight = ta.clientHeight;
			var posY = coords.top + scrollTop;

			if(posY < scrollTop + 50 || posY > scrollTop + viewHeight - 50) {
				ta.scrollTop = Math.max(0, posY - viewHeight / 3);
			}
		}
	}
};

// ==================== BRACKET MATCHING ====================

JumpNavigationPlugin.prototype.jumpToMatchingBracket = function() {
	var ta = this.engine.domNode;
	var text = ta.value;
	var pos = ta.selectionStart;

	var pairs = {
		"(": ")", "[": "]", "{": "}",
		")": "(", "]": "[", "}": "{"
	};

	// Also handle wikitext pairs
	var wikitextPairs = [
		{ open: "[[", close: "]]" },
		{ open: "{{", close: "}}" },
		{ open: "<<", close: ">>" }
	];

	// Check single-char brackets
	var ch = text[pos] || text[pos - 1];
	var checkPos = text[pos] && pairs[text[pos]] ? pos : pos - 1;

	if(checkPos >= 0 && pairs[ch]) {
		var target;
		if(ch === "(" || ch === "[" || ch === "{") {
			target = this.findForward(text, checkPos, ch, pairs[ch]);
		} else {
			target = this.findBackward(text, checkPos, pairs[ch], ch);
		}

		if(target !== -1) {
			this.addToHistory(pos);
			ta.selectionStart = target;
			ta.selectionEnd = target;
			this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();
			return;
		}
	}

	// Check wikitext pairs
	for(var i = 0; i < wikitextPairs.length; i++) {
		var pair = wikitextPairs[i];

		// Check if at open
		if(text.substring(pos, pos + pair.open.length) === pair.open) {
			var closePos = this.findForwardToken(text, pos + pair.open.length, pair.open, pair.close);
			if(closePos !== -1) {
				this.addToHistory(pos);
				ta.selectionStart = closePos;
				ta.selectionEnd = closePos;
				this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();
				return;
			}
		}

		// Check if at close
		if(text.substring(pos - pair.close.length, pos) === pair.close) {
			var openPos = this.findBackwardToken(text, pos - pair.close.length, pair.open, pair.close);
			if(openPos !== -1) {
				this.addToHistory(pos);
				ta.selectionStart = openPos;
				ta.selectionEnd = openPos;
				this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();
				return;
			}
		}
	}
};

JumpNavigationPlugin.prototype.findForward = function(text, pos, open, close) {
	var depth = 0;
	for(var i = pos; i < text.length; i++) {
		if(text[i] === open) depth++;
		else if(text[i] === close) {
			depth--;
			if(depth === 0) return i;
		}
	}
	return -1;
};

JumpNavigationPlugin.prototype.findBackward = function(text, pos, open, close) {
	var depth = 0;
	for(var i = pos; i >= 0; i--) {
		if(text[i] === close) depth++;
		else if(text[i] === open) {
			depth--;
			if(depth === 0) return i;
		}
	}
	return -1;
};

JumpNavigationPlugin.prototype.findForwardToken = function(text, startPos, open, close) {
	var depth = 1;
	var i = startPos;
	while(i < text.length) {
		if(text.substring(i, i + close.length) === close) {
			depth--;
			if(depth === 0) return i;
			i += close.length;
		} else if(text.substring(i, i + open.length) === open) {
			depth++;
			i += open.length;
		} else {
			i++;
		}
	}
	return -1;
};

JumpNavigationPlugin.prototype.findBackwardToken = function(text, endPos, open, close) {
	var depth = 1;
	var i = endPos - 1;
	while(i >= 0) {
		if(i >= open.length - 1 && text.substring(i - open.length + 1, i + 1) === open) {
			depth--;
			if(depth === 0) return i - open.length + 1;
			i -= open.length;
		} else if(i >= close.length - 1 && text.substring(i - close.length + 1, i + 1) === close) {
			depth++;
			i -= close.length;
		} else {
			i--;
		}
	}
	return -1;
};

// ==================== HISTORY NAVIGATION ====================

JumpNavigationPlugin.prototype.addToHistory = function(pos) {
	if(pos < 0) return;

	// Don't add duplicate consecutive positions
	if(this.history.length > 0 && this.history[this.history.length - 1] === pos) {
		return;
	}

	// Truncate forward history if we're in the middle
	if(this.historyIndex < this.history.length - 1) {
		this.history = this.history.slice(0, this.historyIndex + 1);
	}

	this.history.push(pos);
	if(this.history.length > this.maxHistory) {
		this.history.shift();
	}
	this.historyIndex = this.history.length - 1;
};

JumpNavigationPlugin.prototype.jumpHistory = function(direction) {
	if(this.history.length === 0) return;

	var newIndex = this.historyIndex + direction;
	if(newIndex < 0 || newIndex >= this.history.length) return;

	this.historyIndex = newIndex;
	var pos = this.history[this.historyIndex];

	var ta = this.engine.domNode;
	ta.selectionStart = pos;
	ta.selectionEnd = pos;
	this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();

	this.scrollToPosition(pos);
};

// ==================== OPEN LINK ====================

JumpNavigationPlugin.prototype.openLinkUnderCursor = function() {
	var ta = this.engine.domNode;
	var text = ta.value;
	var pos = ta.selectionStart;

	// Find nearest [[ ... ]]
	var left = text.lastIndexOf("[[", pos);
	var right = text.indexOf("]]", pos);

	if(left === -1 || right === -1 || right < left) return;

	var inside = text.substring(left + 2, right);
	var parts = inside.split("|");
	var target = (parts.length > 1 ? parts[1] : parts[0]).trim();

	if(!target) return;

	// Dispatch TiddlyWiki navigation event
	if(this.engine.widget && this.engine.widget.dispatchEvent) {
		this.engine.widget.dispatchEvent({
			type: "tm-navigate",
			navigateTo: target
		});
	}
};

// ==================== BREADCRUMB ====================

JumpNavigationPlugin.prototype.createBreadcrumb = function() {
	var layer = this.engine.getDecorationLayer && this.engine.getDecorationLayer();
	if(!layer) return;

	var doc = this.engine.getDocument();

	this.breadcrumb = doc.createElement("div");
	this.breadcrumb.className = "tc-jump-breadcrumb";
	this.breadcrumb.style.display = "none";

	layer.appendChild(this.breadcrumb);
};

JumpNavigationPlugin.prototype.removeBreadcrumb = function() {
	if(this.breadcrumb && this.breadcrumb.parentNode) {
		this.breadcrumb.parentNode.removeChild(this.breadcrumb);
	}
	this.breadcrumb = null;
};

JumpNavigationPlugin.prototype.updateBreadcrumb = function() {
	if(!this.breadcrumb) return;

	var ta = this.engine.domNode;
	var text = ta.value;
	var pos = ta.selectionStart;

	// Find current heading context
	var lines = text.split("\n");
	var linePos = 0;
	var currentLine = 0;

	for(var i = 0; i < lines.length; i++) {
		if(linePos + lines[i].length >= pos) {
			currentLine = i;
			break;
		}
		linePos += lines[i].length + 1;
	}

	// Find heading hierarchy
	var headings = [];
	for(i = currentLine; i >= 0; i--) {
		var match = lines[i].match(/^(!{1,6})\s+(.+)$/);
		if(match) {
			var level = match[1].length;
			// Only add if higher level than last added
			if(headings.length === 0 || level < headings[0].level) {
				headings.unshift({ level: level, text: match[2] });
			}
			if(level === 1) break; // Top level reached
		}
	}

	if(headings.length === 0) {
		this.breadcrumb.style.display = "none";
		return;
	}

	// Build breadcrumb text
	var breadcrumbText = headings.map(function(h) { return h.text; }).join(" › ");
	this.breadcrumb.textContent = breadcrumbText;
	this.breadcrumb.style.display = "block";
};

// ==================== API ALIASES ====================
// For factory.js message handler compatibility

JumpNavigationPlugin.prototype.openGotoLine = function() {
	this.openDialog("line");
};

JumpNavigationPlugin.prototype.openGotoSymbol = function() {
	this.openDialog("symbol");
};

JumpNavigationPlugin.prototype.jumpToMatch = function() {
	this.jumpToMatchingBracket();
};