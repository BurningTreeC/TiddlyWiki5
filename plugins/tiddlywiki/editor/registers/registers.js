/*\
title: $:/plugins/tiddlywiki/editor/registers/registers.js
type: application/javascript
module-type: editor-plugin

Enhanced Vim-style named registers with:
- Visual register picker UI (no prompts)
- Register contents preview
- Register persistence via tiddler (optional)
- System clipboard integration
- Special registers:
  - " (unnamed default)
  - 0 (yank register)
  - + (system clipboard)
  - * (primary selection)
  - _ (black hole)
  - / (last search)
  - : (last command)
- Multi-cursor paste support
- Register history

Keyboard shortcuts:
- Ctrl+Alt+C: Copy to named register
- Ctrl+Alt+V: Paste from named register
- Ctrl+Alt+R: Show registers panel

\*/

"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "registers";
exports.configTiddler = "$:/config/Editor/EnableRegisters";
exports.defaultEnabled = false;
exports.description = "Vim-style named registers with visual picker";
exports.category = "editing";
exports.supports = { simple: true, framed: true };

exports.create = function(engine) { return new RegistersPlugin(engine); };

// ==================== SPECIAL REGISTERS ====================
var SPECIAL_REGISTERS = {
	'"': { name: "Unnamed", description: "Default register" },
	'0': { name: "Yank", description: "Last yanked text" },
	'+': { name: "Clipboard", description: "System clipboard" },
	'*': { name: "Selection", description: "Primary selection" },
	'_': { name: "Black hole", description: "Discards content" },
	'/': { name: "Search", description: "Last search pattern" },
	':': { name: "Command", description: "Last command" }
};

// ==================== PLUGIN IMPLEMENTATION ====================

function RegistersPlugin(engine) {
	this.engine = engine;
	this.name = "registers";
	this.enabled = false;

	// Initialize registers
	if(!engine._twRegisters) {
		engine._twRegisters = {};
	}
	this.registers = engine._twRegisters;

	// UI elements
	this.panel = null;
	this.styleEl = null;

	// State
	this.mode = null; // "copy", "paste", or "view"
	this.selectedRegister = '"';

	// Options
	this.options = {
		persistRegisters: false,
		persistTiddler: "$:/state/Editor/Registers",
		maxHistory: 10
	};

	// History for unnamed register
	this.history = [];

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this),
		focus: this.onFocus.bind(this)
	};
}

// ==================== LIFECYCLE ====================

RegistersPlugin.prototype.enable = function() {
	this.enabled = true;
	this.injectStyles();
	this.loadRegisters();
};

RegistersPlugin.prototype.disable = function() {
	this.enabled = false;
	this.closePanel();
	this.removeStyles();
};

RegistersPlugin.prototype.destroy = function() {
	this.disable();
};

RegistersPlugin.prototype.configure = function(options) {
	if(!options) return;
	for(var key in options) {
		if(this.options.hasOwnProperty(key)) {
			this.options[key] = options[key];
		}
	}
};

// ==================== STYLES ====================

RegistersPlugin.prototype.injectStyles = function() {
	if(this.styleEl) return;

	var doc = this.engine.getDocument ? this.engine.getDocument() : document;
	if(!doc) return;

	this.styleEl = doc.createElement("style");
	this.styleEl.textContent = [
		".tc-registers-panel {",
		"  position: absolute;",
		"  top: 50%;",
		"  left: 50%;",
		"  transform: translate(-50%, -50%);",
		"  width: 450px;",
		"  max-width: 90%;",
		"  max-height: 80%;",
		"  background: var(--tc-reg-bg, #fff);",
		"  border: 1px solid var(--tc-reg-border, #ddd);",
		"  border-radius: 8px;",
		"  box-shadow: 0 8px 32px rgba(0,0,0,0.25);",
		"  z-index: 100;",
		"  display: flex;",
		"  flex-direction: column;",
		"  overflow: hidden;",
		"}",

		".tc-registers-header {",
		"  padding: 14px 16px;",
		"  background: var(--tc-reg-header-bg, #f8f9fa);",
		"  border-bottom: 1px solid var(--tc-reg-border, #ddd);",
		"  font-weight: 600;",
		"  font-size: 14px;",
		"}",

		".tc-registers-list {",
		"  flex: 1;",
		"  overflow-y: auto;",
		"  padding: 8px 0;",
		"}",

		".tc-registers-item {",
		"  padding: 10px 16px;",
		"  cursor: pointer;",
		"  display: flex;",
		"  align-items: flex-start;",
		"  gap: 12px;",
		"  border-bottom: 1px solid var(--tc-reg-item-border, #f0f0f0);",
		"}",
		".tc-registers-item:last-child {",
		"  border-bottom: none;",
		"}",
		".tc-registers-item:hover {",
		"  background: var(--tc-reg-item-hover, #f5f8ff);",
		"}",
		".tc-registers-item.selected {",
		"  background: var(--tc-reg-item-selected, #e6f0ff);",
		"}",
		".tc-registers-item.empty {",
		"  opacity: 0.5;",
		"}",

		".tc-registers-key {",
		"  flex: 0 0 auto;",
		"  width: 28px;",
		"  height: 28px;",
		"  display: flex;",
		"  align-items: center;",
		"  justify-content: center;",
		"  background: var(--tc-reg-key-bg, #e9ecef);",
		"  border-radius: 4px;",
		"  font-family: monospace;",
		"  font-size: 14px;",
		"  font-weight: 600;",
		"}",
		".tc-registers-key.special {",
		"  background: var(--tc-reg-key-special, #d4edff);",
		"  color: var(--tc-reg-key-special-fg, #0066cc);",
		"}",

		".tc-registers-content {",
		"  flex: 1;",
		"  min-width: 0;",
		"  overflow: hidden;",
		"}",

		".tc-registers-name {",
		"  font-size: 12px;",
		"  color: var(--tc-reg-name, #666);",
		"  margin-bottom: 4px;",
		"}",

		".tc-registers-preview {",
		"  font-family: monospace;",
		"  font-size: 12px;",
		"  color: var(--tc-reg-preview, #333);",
		"  white-space: nowrap;",
		"  overflow: hidden;",
		"  text-overflow: ellipsis;",
		"  max-height: 2.4em;",
		"  line-height: 1.2;",
		"}",
		".tc-registers-preview.multiline {",
		"  white-space: pre;",
		"}",

		".tc-registers-meta {",
		"  font-size: 11px;",
		"  color: var(--tc-reg-meta, #888);",
		"  margin-top: 2px;",
		"}",

		".tc-registers-footer {",
		"  padding: 10px 16px;",
		"  background: var(--tc-reg-footer-bg, #f8f9fa);",
		"  border-top: 1px solid var(--tc-reg-border, #ddd);",
		"  font-size: 11px;",
		"  color: var(--tc-reg-footer-fg, #888);",
		"  display: flex;",
		"  justify-content: space-between;",
		"}",

		".tc-registers-hint {",
		"  display: inline-flex;",
		"  align-items: center;",
		"  gap: 4px;",
		"}",
		".tc-registers-hint kbd {",
		"  padding: 2px 6px;",
		"  background: var(--tc-reg-kbd-bg, #e9ecef);",
		"  border-radius: 3px;",
		"  font-family: inherit;",
		"  font-size: 10px;",
		"}",

		".tc-registers-section {",
		"  padding: 6px 16px;",
		"  font-size: 11px;",
		"  font-weight: 600;",
		"  color: var(--tc-reg-section, #888);",
		"  text-transform: uppercase;",
		"  background: var(--tc-reg-section-bg, #fafafa);",
		"}"
	].join("\n");

	(doc.head || doc.documentElement).appendChild(this.styleEl);
};

RegistersPlugin.prototype.removeStyles = function() {
	if(this.styleEl && this.styleEl.parentNode) {
		this.styleEl.parentNode.removeChild(this.styleEl);
	}
	this.styleEl = null;
};

// ==================== EVENT HOOKS ====================

RegistersPlugin.prototype.onFocus = function() {
	// Load registers on focus if persistence is enabled
	if(this.options.persistRegisters) {
		this.loadRegisters();
	}
};

RegistersPlugin.prototype.onKeydown = function(event) {
	if(!this.enabled) return;

	var ctrl = event.ctrlKey || event.metaKey;

	// Panel is open
	if(this.panel) {
		return this.handlePanelKeydown(event);
	}

	// Ctrl+Alt+C: Copy to named register
	if(ctrl && event.altKey && !event.shiftKey && (event.key === "c" || event.key === "C")) {
		event.preventDefault();
		this.openPanel("copy");
		return false;
	}

	// Ctrl+Alt+V: Paste from named register
	if(ctrl && event.altKey && !event.shiftKey && (event.key === "v" || event.key === "V")) {
		event.preventDefault();
		this.openPanel("paste");
		return false;
	}

	// Ctrl+Alt+R: View registers
	if(ctrl && event.altKey && !event.shiftKey && (event.key === "r" || event.key === "R")) {
		event.preventDefault();
		this.openPanel("view");
		return false;
	}
};

// ==================== COMMANDS (for command palette) ====================

RegistersPlugin.prototype.getCommands = function() {
	var self = this;
	return [
		{
			name: "Copy to Register",
			shortcut: "Ctrl+Alt+C",
			category: "Editing",
			run: function() { self.openPanel("copy"); }
		},
		{
			name: "Paste from Register",
			shortcut: "Ctrl+Alt+V",
			category: "Editing",
			run: function() { self.openPanel("paste"); }
		},
		{
			name: "View Registers",
			shortcut: "Ctrl+Alt+R",
			category: "Editing",
			run: function() { self.openPanel("view"); }
		},
		{
			name: "Clear All Registers",
			category: "Editing",
			run: function() { self.clearAllRegisters(); }
		}
	];
};

// ==================== PANEL ====================

RegistersPlugin.prototype.openPanel = function(mode) {
	if(this.panel) this.closePanel();

	this.mode = mode;
	this.selectedRegister = '"';

	var doc = this.engine.getDocument ? this.engine.getDocument() : document;
	var wrapper = this.engine.getWrapperNode ? this.engine.getWrapperNode() : this.engine.parentNode;
	if(!doc || !wrapper) return;

	this.panel = doc.createElement("div");
	this.panel.className = "tc-registers-panel";

	// Header
	var header = doc.createElement("div");
	header.className = "tc-registers-header";

	var titles = {
		copy: "Copy to Register",
		paste: "Paste from Register",
		view: "Registers"
	};
	header.textContent = titles[mode] || "Registers";
	this.panel.appendChild(header);

	// List
	this.list = doc.createElement("div");
	this.list.className = "tc-registers-list";
	this.panel.appendChild(this.list);

	// Footer
	var footer = doc.createElement("div");
	footer.className = "tc-registers-footer";

	var hints = doc.createElement("div");
	hints.className = "tc-registers-hint";
	hints.innerHTML = "<kbd>a-z</kbd> select • <kbd>↵</kbd> confirm • <kbd>Esc</kbd> cancel";
	footer.appendChild(hints);

	if(mode === "view") {
		var clearBtn = doc.createElement("button");
		clearBtn.textContent = "Clear All";
		clearBtn.style.cssText = "border:none;background:none;color:#666;cursor:pointer;font-size:11px;";
		clearBtn.onclick = function() { self.clearAllRegisters(); self.renderList(); };
		footer.appendChild(clearBtn);
	}

	this.panel.appendChild(footer);

	wrapper.appendChild(this.panel);

	this.renderList();

	var self = this;

	// Direct key input for register selection
	this._keyHandler = function(e) {
		self.handlePanelKeydown(e);
	};
	doc.addEventListener("keydown", this._keyHandler, true);
};

RegistersPlugin.prototype.closePanel = function() {
	if(this.panel && this.panel.parentNode) {
		this.panel.parentNode.removeChild(this.panel);
	}

	var doc = this.engine.getDocument ? this.engine.getDocument() : document;
	if(this._keyHandler) {
		doc.removeEventListener("keydown", this._keyHandler, true);
		this._keyHandler = null;
	}

	this.panel = null;
	this.list = null;
	this.mode = null;

	// Refocus editor
	if(this.engine.domNode) {
		this.engine.domNode.focus();
	}
};

RegistersPlugin.prototype.handlePanelKeydown = function(event) {
	if(event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		this.closePanel();
		return false;
	}

	if(event.key === "Enter") {
		event.preventDefault();
		event.stopPropagation();
		this.executeAction();
		return false;
	}

	// Arrow keys for navigation
	if(event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		event.stopPropagation();
		this.navigateList(event.key === "ArrowDown" ? 1 : -1);
		return false;
	}

	// Direct register selection (a-z, 0-9, special chars)
	if(event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
		var key = event.key.toLowerCase();
		if(/[a-z0-9"'+*_\/:]/.test(key)) {
			event.preventDefault();
			event.stopPropagation();
			this.selectedRegister = key;
			this.renderList();
			// Auto-execute for copy/paste modes
			if(this.mode === "copy" || this.mode === "paste") {
				this.executeAction();
			}
			return false;
		}
	}

	return false;
};

RegistersPlugin.prototype.navigateList = function(direction) {
	var allRegisters = this.getAllRegisterKeys();
	var currentIndex = allRegisters.indexOf(this.selectedRegister);

	if(currentIndex === -1) currentIndex = 0;

	var newIndex = currentIndex + direction;
	if(newIndex < 0) newIndex = allRegisters.length - 1;
	if(newIndex >= allRegisters.length) newIndex = 0;

	this.selectedRegister = allRegisters[newIndex];
	this.renderList();
};

RegistersPlugin.prototype.getAllRegisterKeys = function() {
	var keys = [];

	// Special registers
	for(var special in SPECIAL_REGISTERS) {
		keys.push(special);
	}

	// Named registers (a-z)
	for(var i = 0; i < 26; i++) {
		keys.push(String.fromCharCode(97 + i)); // a-z
	}

	// Numbered registers (0-9)
	for(i = 0; i < 10; i++) {
		keys.push(String(i));
	}

	return keys;
};

RegistersPlugin.prototype.renderList = function() {
	if(!this.list) return;

	var doc = this.engine.getDocument ? this.engine.getDocument() : document;
	this.list.innerHTML = "";

	var self = this;

	// Section: Special registers
	var specialSection = doc.createElement("div");
	specialSection.className = "tc-registers-section";
	specialSection.textContent = "Special Registers";
	this.list.appendChild(specialSection);

	for(var special in SPECIAL_REGISTERS) {
		this.renderRegisterItem(special, true);
	}

	// Section: Named registers
	var namedSection = doc.createElement("div");
	namedSection.className = "tc-registers-section";
	namedSection.textContent = "Named Registers (a-z)";
	this.list.appendChild(namedSection);

	// Only show non-empty named registers, or all if in copy mode
	for(var i = 0; i < 26; i++) {
		var key = String.fromCharCode(97 + i);
		var content = this.getRegister(key);
		if(this.mode === "copy" || content) {
			this.renderRegisterItem(key, false);
		}
	}

	// Section: Numbered registers (only if has content)
	var hasNumbered = false;
	for(i = 0; i < 10; i++) {
		if(this.getRegister(String(i))) {
			hasNumbered = true;
			break;
		}
	}

	if(hasNumbered) {
		var numSection = doc.createElement("div");
		numSection.className = "tc-registers-section";
		numSection.textContent = "Numbered Registers (0-9)";
		this.list.appendChild(numSection);

		for(i = 0; i < 10; i++) {
			var key = String(i);
			if(this.getRegister(key)) {
				this.renderRegisterItem(key, false);
			}
		}
	}

	// Scroll selected into view
	var selected = this.list.querySelector(".selected");
	if(selected) {
		selected.scrollIntoView({ block: "nearest" });
	}
};

RegistersPlugin.prototype.renderRegisterItem = function(key, isSpecial) {
	var doc = this.engine.getDocument ? this.engine.getDocument() : document;
	var content = this.getRegister(key);
	var specialInfo = SPECIAL_REGISTERS[key];

	var item = doc.createElement("div");
	item.className = "tc-registers-item";
	if(key === this.selectedRegister) item.classList.add("selected");
	if(!content && !isSpecial) item.classList.add("empty");

	// Key badge
	var keyBadge = doc.createElement("div");
	keyBadge.className = "tc-registers-key" + (isSpecial ? " special" : "");
	keyBadge.textContent = key;
	item.appendChild(keyBadge);

	// Content area
	var contentArea = doc.createElement("div");
	contentArea.className = "tc-registers-content";

	// Name/description
	var name = doc.createElement("div");
	name.className = "tc-registers-name";
	if(specialInfo) {
		name.textContent = specialInfo.name + " — " + specialInfo.description;
	} else {
		name.textContent = "Register " + key.toUpperCase();
	}
	contentArea.appendChild(name);

	// Preview
	if(content) {
		var preview = doc.createElement("div");
		preview.className = "tc-registers-preview";
		var previewText = content.length > 100 ? content.substring(0, 100) + "…" : content;
		preview.textContent = previewText;
		if(content.indexOf("\n") !== -1) {
			preview.classList.add("multiline");
		}
		contentArea.appendChild(preview);

		// Meta info
		var meta = doc.createElement("div");
		meta.className = "tc-registers-meta";
		var lines = content.split("\n").length;
		meta.textContent = content.length + " chars, " + lines + " line" + (lines > 1 ? "s" : "");
		contentArea.appendChild(meta);
	} else if(key === "+") {
		var clipNote = doc.createElement("div");
		clipNote.className = "tc-registers-preview";
		clipNote.textContent = "(system clipboard)";
		clipNote.style.fontStyle = "italic";
		contentArea.appendChild(clipNote);
	} else if(key === "_") {
		var holeNote = doc.createElement("div");
		holeNote.className = "tc-registers-preview";
		holeNote.textContent = "(content discarded)";
		holeNote.style.fontStyle = "italic";
		contentArea.appendChild(holeNote);
	}

	item.appendChild(contentArea);

	// Click handler
	var self = this;
	item.addEventListener("click", function() {
		self.selectedRegister = key;
		self.renderList();
		if(self.mode === "copy" || self.mode === "paste") {
			self.executeAction();
		}
	});

	this.list.appendChild(item);
};

// ==================== REGISTER OPERATIONS ====================

RegistersPlugin.prototype.getRegister = function(key) {
	if(key === "_") return ""; // Black hole
	if(key === "+") {
		// System clipboard - can't read synchronously
		return this.registers["+"] || "";
	}
	return this.registers[key] || "";
};

RegistersPlugin.prototype.setRegister = function(key, content) {
	if(key === "_") return; // Black hole discards

	// Update history for unnamed register
	if(key === '"') {
		this.history.unshift(content);
		if(this.history.length > this.options.maxHistory) {
			this.history.pop();
		}
	}

	this.registers[key] = content;

	// Also update unnamed register for most operations
	if(key !== '"' && key !== '+' && key !== '*') {
		this.registers['"'] = content;
	}

	// System clipboard
	if(key === '+' || key === '*') {
		this.writeToClipboard(content);
	}

	// Persist if enabled
	if(this.options.persistRegisters) {
		this.saveRegisters();
	}
};

RegistersPlugin.prototype.executeAction = function() {
	if(this.mode === "copy") {
		this.copyToRegister(this.selectedRegister);
	} else if(this.mode === "paste") {
		this.pasteFromRegister(this.selectedRegister);
	}
	this.closePanel();
};

RegistersPlugin.prototype.copyToRegister = function(key) {
	var ta = this.engine.domNode;
	var start = ta.selectionStart;
	var end = ta.selectionEnd;

	if(start === end) return; // No selection

	var text = ta.value.substring(start, end);
	this.setRegister(key, text);

	// Also set yank register
	this.registers['0'] = text;
};

RegistersPlugin.prototype.pasteFromRegister = function(key) {
	var content;

	if(key === '+') {
		// Try to read from clipboard
		this.readFromClipboard(function(text) {
			if(text) {
				this.doPaste(text);
			}
		}.bind(this));
		return;
	}

	content = this.getRegister(key);
	if(content) {
		this.doPaste(content);
	}
};

RegistersPlugin.prototype.doPaste = function(content) {
	// Multi-cursor support
	if(this.engine.insertAtAllCursors) {
		this.engine.insertAtAllCursors(content);
		return;
	}

	// Single cursor fallback
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var start = ta.selectionStart;
	var end = ta.selectionEnd;

	engine.captureBeforeState && engine.captureBeforeState();

	ta.value = text.substring(0, start) + content + text.substring(end);
	var newPos = start + content.length;
	ta.selectionStart = newPos;
	ta.selectionEnd = newPos;

	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

// ==================== CLIPBOARD ====================

RegistersPlugin.prototype.writeToClipboard = function(text) {
	if(navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(text).catch(function(e) {
			console.warn("Clipboard write failed:", e);
		});
	}
};

RegistersPlugin.prototype.readFromClipboard = function(callback) {
	if(navigator.clipboard && navigator.clipboard.readText) {
		navigator.clipboard.readText().then(function(text) {
			callback(text);
		}).catch(function(e) {
			console.warn("Clipboard read failed:", e);
			callback(null);
		});
	} else {
		callback(null);
	}
};

// ==================== PERSISTENCE ====================

RegistersPlugin.prototype.loadRegisters = function() {
	if(!this.options.persistRegisters) return;

	var wiki = this.engine.wiki;
	if(!wiki) return;

	try {
		var data = wiki.getTiddlerData(this.options.persistTiddler, {});
		for(var key in data) {
			if(typeof data[key] === "string") {
				this.registers[key] = data[key];
			}
		}
	} catch(e) {
		console.warn("Failed to load registers:", e);
	}
};

RegistersPlugin.prototype.saveRegisters = function() {
	if(!this.options.persistRegisters) return;

	var wiki = this.engine.wiki;
	if(!wiki) return;

	try {
		// Only save named registers (a-z) and numbered (0-9)
		var data = {};
		for(var key in this.registers) {
			if(/^[a-z0-9]$/.test(key) && this.registers[key]) {
				data[key] = this.registers[key];
			}
		}
		wiki.setTiddlerData(this.options.persistTiddler, data);
	} catch(e) {
		console.warn("Failed to save registers:", e);
	}
};

RegistersPlugin.prototype.clearAllRegisters = function() {
	this.registers = {};
	this.engine._twRegisters = this.registers;
	this.history = [];

	if(this.options.persistRegisters) {
		this.saveRegisters();
	}
};