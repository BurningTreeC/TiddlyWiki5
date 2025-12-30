/*\
title: $:/plugins/tiddlywiki/editor/command-palette/command-palette.js
type: application/javascript
module-type: editor-plugin

Enhanced Command Palette with:
- Dynamic command discovery from all plugins
- Fuzzy matching for command search
- Keybinding display next to commands
- Command categories and grouping
- Recently used commands
- Custom user commands via tiddlers
- Better styling and animations

Shortcuts:
- Ctrl+Shift+P: Open command palette
- Escape: Close
- Arrow Up/Down: Navigate
- Enter: Execute selected command

Custom commands can be defined in tiddlers with tag $:/tags/Editor/Command
Fields:
- command-name: Display name
- command-action: Action type (widget-message, plugin-toggle, script)
- command-param: Parameter for action
- command-description: Optional description
- command-shortcut: Display shortcut hint

\*/

"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "command-palette";
exports.configTiddler = "$:/config/Editor/EnableCommandPalette";
exports.configTiddlerAlt = "$:/config/EnableCommandPalette";
exports.defaultEnabled = true;
exports.description = "Quick command access via Ctrl+Shift+P";
exports.category = "navigation";
exports.supports = { simple: true, framed: true };

exports.create = function(engine) { return new CommandPalettePlugin(engine); };

// ==================== CONSTANTS ====================
var PALETTE_CLASS = "tc-cmdpal";
var MAX_RECENT = 5;
var MAX_RESULTS = 15;

// ==================== BUILT-IN COMMANDS ====================

var BUILTIN_COMMANDS = [
	// Plugin toggles
	{
		id: "toggle-vim-mode",
		name: "Toggle Vim Mode",
		category: "Plugins",
		shortcut: "",
		description: "Enable/disable Vim keybindings",
		action: function(engine) {
			var p = engine.getPlugin && engine.getPlugin("vim-mode");
			if(p) { p.enabled ? p.disable() : p.enable(); }
		}
	},
	{
		id: "toggle-multi-cursor",
		name: "Toggle Multi-Cursor",
		category: "Plugins",
		shortcut: "",
		description: "Enable/disable multi-cursor editing",
		action: function(engine) {
			var p = engine.getPlugin && engine.getPlugin("multi-cursor");
			if(p) { p.enabled ? p.disable() : p.enable(); }
		}
	},
	{
		id: "toggle-smart-pairs",
		name: "Toggle Smart Pairs",
		category: "Plugins",
		shortcut: "",
		description: "Auto-close brackets and quotes",
		action: function(engine) {
			var p = engine.getPlugin && engine.getPlugin("smart-pairs");
			if(p) { p.enabled ? p.disable() : p.enable(); }
		}
	},
	{
		id: "toggle-line-numbers",
		name: "Toggle Line Numbers",
		category: "Display",
		shortcut: "",
		description: "Show/hide line numbers in gutter",
		action: function(engine) {
			var p = engine.getPlugin && engine.getPlugin("line-numbers");
			if(p) { p.enabled ? p.disable() : p.enable(); }
		}
	},
	{
		id: "toggle-autocomplete",
		name: "Toggle Autocomplete",
		category: "Plugins",
		shortcut: "",
		description: "Enable/disable autocomplete popups",
		action: function(engine) {
			var p = engine.getPlugin && engine.getPlugin("autocomplete");
			if(p) { p.enabled ? p.disable() : p.enable(); }
		}
	},

	// Navigation
	{
		id: "go-to-line",
		name: "Go to Line...",
		category: "Navigation",
		shortcut: "Ctrl+G",
		description: "Jump to a specific line number",
		action: function(engine) {
			var n = prompt("Go to line:", "1");
			if(!n) return;
			var line = Math.max(1, parseInt(n, 10) || 1);
			var pos = engine.getPositionForLineColumn ? engine.getPositionForLineColumn(line - 1, 0) : 0;
			engine.domNode.selectionStart = pos;
			engine.domNode.selectionEnd = pos;
			engine.syncCursorFromDOM && engine.syncCursorFromDOM();
		}
	},
	{
		id: "go-to-start",
		name: "Go to Start of Document",
		category: "Navigation",
		shortcut: "Ctrl+Home",
		description: "Jump to the beginning",
		action: function(engine) {
			engine.domNode.selectionStart = 0;
			engine.domNode.selectionEnd = 0;
			engine.syncCursorFromDOM && engine.syncCursorFromDOM();
		}
	},
	{
		id: "go-to-end",
		name: "Go to End of Document",
		category: "Navigation",
		shortcut: "Ctrl+End",
		description: "Jump to the end",
		action: function(engine) {
			var len = engine.domNode.value.length;
			engine.domNode.selectionStart = len;
			engine.domNode.selectionEnd = len;
			engine.syncCursorFromDOM && engine.syncCursorFromDOM();
		}
	},

	// Search
	{
		id: "find",
		name: "Find...",
		category: "Search",
		shortcut: "Ctrl+F",
		description: "Open search bar",
		action: function(engine) {
			var p = engine.getPlugin && engine.getPlugin("search-enhanced");
			if(p && p.open) { p.open(false); }
		}
	},
	{
		id: "find-replace",
		name: "Find and Replace...",
		category: "Search",
		shortcut: "Ctrl+H",
		description: "Open search with replace",
		action: function(engine) {
			var p = engine.getPlugin && engine.getPlugin("search-enhanced");
			if(p && p.open) { p.open(true); }
		}
	},

	// Editing
	{
		id: "select-all",
		name: "Select All",
		category: "Editing",
		shortcut: "Ctrl+A",
		description: "Select entire document",
		action: function(engine) {
			engine.domNode.selectionStart = 0;
			engine.domNode.selectionEnd = engine.domNode.value.length;
			engine.syncCursorFromDOM && engine.syncCursorFromDOM();
		}
	},
	{
		id: "duplicate-line",
		name: "Duplicate Line/Selection",
		category: "Editing",
		shortcut: "Ctrl+Shift+D",
		description: "Duplicate current line or selection",
		action: function(engine) {
			var p = engine.getPlugin && engine.getPlugin("line-block");
			if(p && p.duplicateSelectionOrLines) {
				p.duplicateSelectionOrLines();
			}
		}
	},
	{
		id: "delete-line",
		name: "Delete Line",
		category: "Editing",
		shortcut: "Ctrl+Shift+K",
		description: "Delete current line",
		action: function(engine) {
			var p = engine.getPlugin && engine.getPlugin("line-block");
			if(p && p.deleteSelectionOrLines) {
				p.deleteSelectionOrLines();
			}
		}
	},
	{
		id: "undo",
		name: "Undo",
		category: "Editing",
		shortcut: "Ctrl+Z",
		description: "Undo last change",
		action: function(engine) {
			engine.undo && engine.undo();
		}
	},
	{
		id: "redo",
		name: "Redo",
		category: "Editing",
		shortcut: "Ctrl+Y",
		description: "Redo last undone change",
		action: function(engine) {
			engine.redo && engine.redo();
		}
	},

	// Folding
	{
		id: "fold-current",
		name: "Fold Current Section",
		category: "Folding",
		shortcut: "Ctrl+Shift+[",
		description: "Collapse the current section",
		action: function(engine) {
			var p = engine.getPlugin && engine.getPlugin("folding");
			if(p && p.foldCurrentSection) { p.foldCurrentSection(true); }
		}
	},
	{
		id: "unfold-current",
		name: "Unfold Current Section",
		category: "Folding",
		shortcut: "Ctrl+Shift+]",
		description: "Expand the current section",
		action: function(engine) {
			var p = engine.getPlugin && engine.getPlugin("folding");
			if(p && p.foldCurrentSection) { p.foldCurrentSection(false); }
		}
	},

	// Selection
	{
		id: "expand-selection",
		name: "Expand Selection",
		category: "Selection",
		shortcut: "Alt+Shift+↑",
		description: "Expand selection to next semantic unit",
		action: function(engine) {
			var p = engine.getPlugin && engine.getPlugin("structural-selection");
			if(p && p.expand) { p.expand(); }
		}
	},
	{
		id: "shrink-selection",
		name: "Shrink Selection",
		category: "Selection",
		shortcut: "Alt+Shift+↓",
		description: "Shrink selection to previous unit",
		action: function(engine) {
			var p = engine.getPlugin && engine.getPlugin("structural-selection");
			if(p && p.shrink) { p.shrink(); }
		}
	}
];

// ==================== PLUGIN IMPLEMENTATION ====================

function CommandPalettePlugin(engine) {
	this.engine = engine;
	this.name = "command-palette";
	this.enabled = false;

	// UI elements
	this.ui = null;
	this.input = null;
	this.list = null;
	this.styleEl = null;

	// State
	this.commands = [];
	this.filtered = [];
	this.selectedIndex = 0;
	this.recentCommands = []; // Array of command IDs

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this)
	};
}

// ==================== LIFECYCLE ====================

CommandPalettePlugin.prototype.enable = function() {
	this.enabled = true;
	this.loadRecentCommands();
};

CommandPalettePlugin.prototype.disable = function() {
	this.enabled = false;
	this.close();
};

CommandPalettePlugin.prototype.destroy = function() {
	this.disable();
	this.removeStyles();
};

// ==================== STYLES ====================

CommandPalettePlugin.prototype.injectStyles = function() {
	if(this.styleEl) return;

	var doc = this.getDocument();
	if(!doc) return;

	this.styleEl = doc.createElement("style");
	this.styleEl.textContent = [
		"." + PALETTE_CLASS + " {",
		"  position: absolute;",
		"  top: 50px;",
		"  left: 50%;",
		"  transform: translateX(-50%);",
		"  width: 500px;",
		"  max-width: 90%;",
		"  background: var(--tc-cmdpal-bg, #ffffff);",
		"  border: 1px solid var(--tc-cmdpal-border, #ddd);",
		"  border-radius: 8px;",
		"  box-shadow: 0 8px 32px rgba(0,0,0,0.2);",
		"  z-index: 10000;",
		"  overflow: hidden;",
		"  font-family: inherit;",
		"}",
		"." + PALETTE_CLASS + "-input {",
		"  width: 100%;",
		"  padding: 12px 16px;",
		"  border: none;",
		"  border-bottom: 1px solid var(--tc-cmdpal-border, #eee);",
		"  font-size: 15px;",
		"  outline: none;",
		"  background: transparent;",
		"  box-sizing: border-box;",
		"}",
		"." + PALETTE_CLASS + "-input::placeholder {",
		"  color: var(--tc-cmdpal-placeholder, #999);",
		"}",
		"." + PALETTE_CLASS + "-list {",
		"  max-height: 350px;",
		"  overflow-y: auto;",
		"  padding: 4px 0;",
		"}",
		"." + PALETTE_CLASS + "-category {",
		"  padding: 6px 16px 4px;",
		"  font-size: 11px;",
		"  font-weight: 600;",
		"  text-transform: uppercase;",
		"  letter-spacing: 0.5px;",
		"  color: var(--tc-cmdpal-category, #888);",
		"  background: var(--tc-cmdpal-category-bg, #f8f9fa);",
		"}",
		"." + PALETTE_CLASS + "-item {",
		"  padding: 8px 16px;",
		"  cursor: pointer;",
		"  display: flex;",
		"  align-items: center;",
		"  justify-content: space-between;",
		"  gap: 12px;",
		"  transition: background 0.1s;",
		"}",
		"." + PALETTE_CLASS + "-item:hover {",
		"  background: var(--tc-cmdpal-hover, #f5f5f5);",
		"}",
		"." + PALETTE_CLASS + "-item.is-selected {",
		"  background: var(--tc-cmdpal-selected, #e3f2fd);",
		"}",
		"." + PALETTE_CLASS + "-item-main {",
		"  flex: 1;",
		"  min-width: 0;",
		"}",
		"." + PALETTE_CLASS + "-item-name {",
		"  font-weight: 500;",
		"  white-space: nowrap;",
		"  overflow: hidden;",
		"  text-overflow: ellipsis;",
		"}",
		"." + PALETTE_CLASS + "-item-name mark {",
		"  background: var(--tc-cmdpal-highlight, #fff59d);",
		"  padding: 0 1px;",
		"  border-radius: 2px;",
		"}",
		"." + PALETTE_CLASS + "-item-desc {",
		"  font-size: 12px;",
		"  color: var(--tc-cmdpal-desc, #666);",
		"  white-space: nowrap;",
		"  overflow: hidden;",
		"  text-overflow: ellipsis;",
		"}",
		"." + PALETTE_CLASS + "-item-shortcut {",
		"  flex: 0 0 auto;",
		"  padding: 3px 6px;",
		"  font-size: 11px;",
		"  font-family: monospace;",
		"  background: var(--tc-cmdpal-shortcut-bg, #eee);",
		"  border-radius: 3px;",
		"  color: var(--tc-cmdpal-shortcut-fg, #555);",
		"}",
		"." + PALETTE_CLASS + "-empty {",
		"  padding: 20px;",
		"  text-align: center;",
		"  color: var(--tc-cmdpal-empty, #999);",
		"}",
		"." + PALETTE_CLASS + "-footer {",
		"  padding: 8px 16px;",
		"  font-size: 11px;",
		"  color: var(--tc-cmdpal-footer, #888);",
		"  background: var(--tc-cmdpal-footer-bg, #f8f9fa);",
		"  border-top: 1px solid var(--tc-cmdpal-border, #eee);",
		"  display: flex;",
		"  gap: 16px;",
		"}",
		"." + PALETTE_CLASS + "-footer kbd {",
		"  padding: 1px 4px;",
		"  background: var(--tc-cmdpal-kbd-bg, #e9ecef);",
		"  border-radius: 3px;",
		"  font-family: inherit;",
		"}"
	].join("\n");

	(doc.head || doc.documentElement).appendChild(this.styleEl);
};

CommandPalettePlugin.prototype.removeStyles = function() {
	if(this.styleEl && this.styleEl.parentNode) {
		this.styleEl.parentNode.removeChild(this.styleEl);
	}
	this.styleEl = null;
};

// ==================== EVENT HOOKS ====================

CommandPalettePlugin.prototype.onKeydown = function(event) {
	if(!this.enabled) return;

	var ctrl = event.ctrlKey || event.metaKey;

	// Ctrl+Shift+P: Open palette
	if(ctrl && event.shiftKey && !event.altKey && (event.key === "P" || event.key === "p")) {
		event.preventDefault();
		this.open();
		return false;
	}

	// When palette is open
	if(this.ui) {
		if(event.key === "Escape") {
			event.preventDefault();
			this.close();
			return false;
		}
		if(event.key === "ArrowDown") {
			event.preventDefault();
			this.move(1);
			return false;
		}
		if(event.key === "ArrowUp") {
			event.preventDefault();
			this.move(-1);
			return false;
		}
		if(event.key === "Enter") {
			event.preventDefault();
			this.runSelected();
			return false;
		}
		if(event.key === "PageDown") {
			event.preventDefault();
			this.move(5);
			return false;
		}
		if(event.key === "PageUp") {
			event.preventDefault();
			this.move(-5);
			return false;
		}
	}
};

// ==================== OPEN / CLOSE ====================

CommandPalettePlugin.prototype.open = function() {
	if(this.ui) return;

	this.injectStyles();
	this.commands = this.buildCommands();
	this.filtered = this.getInitialList();
	this.selectedIndex = 0;

	this.createUI();
	this.render();
	this.input.focus();
};

CommandPalettePlugin.prototype.close = function() {
	if(!this.ui) return;

	if(this.ui.parentNode) {
		this.ui.parentNode.removeChild(this.ui);
	}
	this.ui = null;
	this.input = null;
	this.list = null;
	this.filtered = [];
	this.selectedIndex = 0;

	// Refocus editor
	if(this.engine.domNode && this.engine.domNode.focus) {
		this.engine.domNode.focus();
	}
};

// ==================== UI CREATION ====================

CommandPalettePlugin.prototype.createUI = function() {
	var doc = this.getDocument();
	var wrap = this.engine.wrapperNode || this.engine.parentNode;
	if(!doc || !wrap) return;

	this.ui = doc.createElement("div");
	this.ui.className = PALETTE_CLASS;

	// Input
	this.input = doc.createElement("input");
	this.input.className = PALETTE_CLASS + "-input";
	this.input.type = "text";
	this.input.placeholder = "Type a command...";
	this.ui.appendChild(this.input);

	// List
	this.list = doc.createElement("div");
	this.list.className = PALETTE_CLASS + "-list";
	this.ui.appendChild(this.list);

	// Footer
	var footer = doc.createElement("div");
	footer.className = PALETTE_CLASS + "-footer";
	footer.innerHTML = "<span><kbd>↑↓</kbd> Navigate</span><span><kbd>Enter</kbd> Run</span><span><kbd>Esc</kbd> Close</span>";
	this.ui.appendChild(footer);

	// Events
	var self = this;

	this.input.addEventListener("input", function() {
		self.filter(self.input.value);
	});

	this.input.addEventListener("keydown", function(e) {
		// Prevent default for navigation keys
		if(e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter") {
			e.preventDefault();
		}
	});

	this.list.addEventListener("click", function(e) {
		var item = e.target.closest("[data-index]");
		if(item) {
			var idx = parseInt(item.getAttribute("data-index"), 10);
			if(!isNaN(idx)) {
				self.selectedIndex = idx;
				self.runSelected();
			}
		}
	});

	this.list.addEventListener("mousemove", function(e) {
		var item = e.target.closest("[data-index]");
		if(item) {
			var idx = parseInt(item.getAttribute("data-index"), 10);
			if(!isNaN(idx) && idx !== self.selectedIndex) {
				self.selectedIndex = idx;
				self.render();
			}
		}
	});

	wrap.appendChild(this.ui);
};

// ==================== COMMAND BUILDING ====================

CommandPalettePlugin.prototype.buildCommands = function() {
	var commands = [];
	var engine = this.engine;

	// Add built-in commands
	for(var i = 0; i < BUILTIN_COMMANDS.length; i++) {
		commands.push(BUILTIN_COMMANDS[i]);
	}

	// Discover commands from plugins
	if(engine.plugins) {
		for(i = 0; i < engine.plugins.length; i++) {
			var plugin = engine.plugins[i];
			if(plugin && plugin.getCommands) {
				try {
					var pluginCmds = plugin.getCommands();
					if(pluginCmds && pluginCmds.length) {
						commands = commands.concat(pluginCmds);
					}
				} catch(e) {
					console.error("Error getting commands from plugin:", plugin.name, e);
				}
			}
		}
	}

	// Load user-defined commands from tiddlers
	var userCmds = this.loadUserCommands();
	commands = commands.concat(userCmds);

	return commands;
};

CommandPalettePlugin.prototype.loadUserCommands = function() {
	var wiki = this.engine.wiki;
	if(!wiki) return [];

	var commands = [];
	var titles = wiki.getTiddlersWithTag("$:/tags/Editor/Command") || [];

	for(var i = 0; i < titles.length; i++) {
		var t = wiki.getTiddler(titles[i]);
		if(!t) continue;

		var name = t.fields["command-name"];
		var action = t.fields["command-action"];
		var param = t.fields["command-param"];

		if(!name || !action) continue;

		commands.push({
			id: "user-" + titles[i],
			name: name,
			category: t.fields["command-category"] || "User Commands",
			shortcut: t.fields["command-shortcut"] || "",
			description: t.fields["command-description"] || "",
			action: this.createUserAction(action, param)
		});
	}

	return commands;
};

CommandPalettePlugin.prototype.createUserAction = function(actionType, param) {
	var engine = this.engine;

	return function() {
		switch(actionType) {
			case "widget-message":
				if(engine.widget && engine.widget.dispatchEvent) {
					engine.widget.dispatchEvent({ type: param });
				}
				break;

			case "plugin-toggle":
				var p = engine.getPlugin && engine.getPlugin(param);
				if(p) {
					p.enabled ? p.disable() : p.enable();
				}
				break;

			case "script":
				try {
					var fn = new Function("engine", param);
					fn(engine);
				} catch(e) {
					console.error("Command script error:", e);
				}
				break;

			default:
				console.warn("Unknown command action type:", actionType);
		}
	};
};

// ==================== FILTERING ====================

CommandPalettePlugin.prototype.getInitialList = function() {
	// Show recent commands first, then all commands
	var recent = [];
	var others = [];

	for(var i = 0; i < this.commands.length; i++) {
		var cmd = this.commands[i];
		if(this.recentCommands.indexOf(cmd.id) !== -1) {
			cmd._isRecent = true;
			recent.push(cmd);
		} else {
			cmd._isRecent = false;
			others.push(cmd);
		}
	}

	// Sort recent by recency
	var self = this;
	recent.sort(function(a, b) {
		return self.recentCommands.indexOf(a.id) - self.recentCommands.indexOf(b.id);
	});

	return recent.concat(others).slice(0, MAX_RESULTS);
};

CommandPalettePlugin.prototype.filter = function(query) {
	query = (query || "").trim();

	if(!query) {
		this.filtered = this.getInitialList();
	} else {
		this.filtered = this.fuzzySearch(query);
	}

	this.selectedIndex = 0;
	this.render();
};

CommandPalettePlugin.prototype.fuzzySearch = function(query) {
	var results = [];
	var q = query.toLowerCase();

	for(var i = 0; i < this.commands.length; i++) {
		var cmd = this.commands[i];
		var name = cmd.name.toLowerCase();
		var desc = (cmd.description || "").toLowerCase();
		var cat = (cmd.category || "").toLowerCase();

		var score = 0;

		// Exact match in name
		if(name === q) {
			score = 1000;
		}
		// Starts with query
		else if(name.startsWith(q)) {
			score = 500 + (100 - name.length);
		}
		// Contains query
		else if(name.indexOf(q) !== -1) {
			score = 200 + (100 - name.indexOf(q));
		}
		// Fuzzy match in name
		else {
			var fuzzy = this.fuzzyScore(name, q);
			if(fuzzy > 0) {
				score = fuzzy;
			}
		}

		// Bonus for description match
		if(desc.indexOf(q) !== -1) {
			score += 50;
		}

		// Bonus for category match
		if(cat.indexOf(q) !== -1) {
			score += 30;
		}

		// Bonus for recent commands
		if(this.recentCommands.indexOf(cmd.id) !== -1) {
			score += 100;
		}

		if(score > 0) {
			results.push({
				command: cmd,
				score: score,
				query: query
			});
		}
	}

	// Sort by score descending
	results.sort(function(a, b) { return b.score - a.score; });

	return results.slice(0, MAX_RESULTS).map(function(r) {
		r.command._query = r.query;
		return r.command;
	});
};

CommandPalettePlugin.prototype.fuzzyScore = function(str, query) {
	var score = 0;
	var strIndex = 0;
	var consecutive = 0;

	for(var i = 0; i < query.length; i++) {
		var ch = query[i];
		var found = false;

		for(var j = strIndex; j < str.length; j++) {
			if(str[j] === ch) {
				found = true;
				score += 1 + consecutive;

				if(j === strIndex) {
					consecutive++;
				} else {
					consecutive = 0;
				}

				// Bonus for word boundaries
				if(j === 0 || /[\s\-_]/.test(str[j - 1])) {
					score += 5;
				}

				strIndex = j + 1;
				break;
			}
		}

		if(!found) return 0;
	}

	return score;
};

// ==================== RENDERING ====================

CommandPalettePlugin.prototype.render = function() {
	if(!this.list) return;

	var doc = this.getDocument();
	this.list.innerHTML = "";

	if(this.filtered.length === 0) {
		var empty = doc.createElement("div");
		empty.className = PALETTE_CLASS + "-empty";
		empty.textContent = "No commands found";
		this.list.appendChild(empty);
		return;
	}

	var frag = doc.createDocumentFragment();
	var lastCategory = null;

	for(var i = 0; i < this.filtered.length; i++) {
		var cmd = this.filtered[i];

		// Category header
		var cat = cmd._isRecent ? "Recent" : (cmd.category || "Other");
		if(cat !== lastCategory) {
			var catEl = doc.createElement("div");
			catEl.className = PALETTE_CLASS + "-category";
			catEl.textContent = cat;
			frag.appendChild(catEl);
			lastCategory = cat;
		}

		// Command item
		var item = doc.createElement("div");
		item.className = PALETTE_CLASS + "-item" + (i === this.selectedIndex ? " is-selected" : "");
		item.setAttribute("data-index", String(i));

		// Main content
		var main = doc.createElement("div");
		main.className = PALETTE_CLASS + "-item-main";

		var nameEl = doc.createElement("div");
		nameEl.className = PALETTE_CLASS + "-item-name";
		nameEl.innerHTML = this.highlightMatch(cmd.name, cmd._query || "");
		main.appendChild(nameEl);

		if(cmd.description) {
			var descEl = doc.createElement("div");
			descEl.className = PALETTE_CLASS + "-item-desc";
			descEl.textContent = cmd.description;
			main.appendChild(descEl);
		}

		item.appendChild(main);

		// Shortcut
		if(cmd.shortcut) {
			var shortcut = doc.createElement("span");
			shortcut.className = PALETTE_CLASS + "-item-shortcut";
			shortcut.textContent = cmd.shortcut;
			item.appendChild(shortcut);
		}

		frag.appendChild(item);
	}

	this.list.appendChild(frag);
	this.scrollToSelected();
};

CommandPalettePlugin.prototype.highlightMatch = function(text, query) {
	if(!query) return this.escapeHtml(text);

	var escaped = this.escapeHtml(text);
	var q = query.toLowerCase();
	var t = text.toLowerCase();

	var index = t.indexOf(q);
	if(index === -1) return escaped;

	var before = this.escapeHtml(text.slice(0, index));
	var match = this.escapeHtml(text.slice(index, index + query.length));
	var after = this.escapeHtml(text.slice(index + query.length));

	return before + "<mark>" + match + "</mark>" + after;
};

CommandPalettePlugin.prototype.escapeHtml = function(str) {
	return String(str)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
};

// ==================== NAVIGATION ====================

CommandPalettePlugin.prototype.move = function(delta) {
	if(this.filtered.length === 0) return;

	this.selectedIndex += delta;

	if(this.selectedIndex < 0) {
		this.selectedIndex = this.filtered.length - 1;
	} else if(this.selectedIndex >= this.filtered.length) {
		this.selectedIndex = 0;
	}

	this.render();
};

CommandPalettePlugin.prototype.scrollToSelected = function() {
	if(!this.list) return;

	var selected = this.list.querySelector(".is-selected");
	if(!selected) return;

	var listRect = this.list.getBoundingClientRect();
	var itemRect = selected.getBoundingClientRect();

	if(itemRect.bottom > listRect.bottom) {
		selected.scrollIntoView({ block: "end", behavior: "auto" });
	} else if(itemRect.top < listRect.top) {
		selected.scrollIntoView({ block: "start", behavior: "auto" });
	}
};

// ==================== EXECUTION ====================

CommandPalettePlugin.prototype.runSelected = function() {
	if(this.filtered.length === 0) return;
	if(this.selectedIndex < 0 || this.selectedIndex >= this.filtered.length) return;

	var cmd = this.filtered[this.selectedIndex];
	this.close();

	// Add to recent commands
	this.addToRecent(cmd.id);

	// Execute
	try {
		if(typeof cmd.action === "function") {
			cmd.action(this.engine);
		}
	} catch(e) {
		console.error("Command execution error:", cmd.name, e);
	}
};

// ==================== RECENT COMMANDS ====================

CommandPalettePlugin.prototype.addToRecent = function(commandId) {
	// Remove if already exists
	var idx = this.recentCommands.indexOf(commandId);
	if(idx !== -1) {
		this.recentCommands.splice(idx, 1);
	}

	// Add to front
	this.recentCommands.unshift(commandId);

	// Limit size
	if(this.recentCommands.length > MAX_RECENT) {
		this.recentCommands = this.recentCommands.slice(0, MAX_RECENT);
	}

	// Persist
	this.saveRecentCommands();
};

CommandPalettePlugin.prototype.loadRecentCommands = function() {
	try {
		var wiki = this.engine.wiki;
		if(!wiki) return;

		var data = wiki.getTiddlerText("$:/state/Editor/RecentCommands");
		if(data) {
			this.recentCommands = JSON.parse(data);
		}
	} catch(e) {
		this.recentCommands = [];
	}
};

CommandPalettePlugin.prototype.saveRecentCommands = function() {
	try {
		var wiki = this.engine.wiki;
		if(!wiki) return;

		wiki.addTiddler(new $tw.Tiddler({
			title: "$:/state/Editor/RecentCommands",
			text: JSON.stringify(this.recentCommands)
		}));
	} catch(e) {
		// Ignore errors
	}
};

// ==================== UTILITIES ====================

CommandPalettePlugin.prototype.getDocument = function() {
	if(this.engine.getDocument) {
		return this.engine.getDocument();
	}
	if(this.engine.widget && this.engine.widget.document) {
		return this.engine.widget.document;
	}
	return document;
};