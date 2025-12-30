/*\
title: $:/core/modules/editor/engines/framed.js
type: application/javascript
module-type: library

Framed text editor engine based on a textarea within an iframe.

Production-ready goals:
- deterministic lifecycle + cleanup (no leaked intervals/listeners)
- correct undo capture (beforeinput + keydown fallbacks + plugin API)
- stable hook execution order + error isolation
- robust multi-cursor core primitives (safe default behavior)
- correct overlay positioning (no scroll double-counting)
- safer iframe boot (always has overlay layers, always has styles)
- click/ctrl+click correctness (plugins can add cursors without losing existing ones)
- IME/composition safety (avoid corrupting multi-cursor state)
- decoration hygiene (optional owner-based clearing)
- Plugin metadata system: plugins declare supports + config tiddlers

Plugin support contract:
exports.supports = { simple: true/false, framed: true/false }  (optional; default true/true)

\*/

"use strict";

var HEIGHT_VALUE_TITLE = "$:/config/TextEditor/EditorHeight/Height";

function FramedEngine(options) {
	options = options || {};
	this.widget = options.widget;
	this.wiki = this.widget && this.widget.wiki;
	this.value = options.value || "";
	this.parentNode = options.parentNode;
	this.nextSibling = options.nextSibling;

	// Plugin system
	this.plugins = [];
	this.pluginMetadata = {}; // name -> metadata
	this.hooks = {
		beforeInput: [],
		afterInput: [],
		beforeKeydown: [],
		afterKeydown: [],
		beforeKeypress: [],
		afterKeypress: [],
		beforeOperation: [],
		afterOperation: [],
		beforeClick: [],
		afterClick: [],
		focus: [],
		blur: [],
		selectionChange: [],
		render: []
	};

	// Cursor model
	this.cursors = [{
		id: "primary",
		start: 0,
		end: 0,
		isPrimary: true
	}];

	this.lastKnownText = "";
	this.lastKnownSelection = { start: 0, end: 0 };

	this._destroyed = false;
	this._listeners = [];
	this._intervals = [];

	this.isComposing = false;

	this.createDOM();
	this.initializeUndoSystem();
	this.initializePlugins();

	this.lastKnownText = this.domNode ? (this.domNode.value || "") : (this.value || "");
	this.lastKnownSelection = {
		start: this.domNode ? (this.domNode.selectionStart || 0) : 0,
		end: this.domNode ? (this.domNode.selectionEnd || 0) : 0
	};

	this.renderCursors();
}

// ==================== DOM / IFRAME ====================

FramedEngine.prototype.createDOM = function() {
	var doc = this.widget.document;

	// Dummy textarea (style source)
	this.dummyTextArea = doc.createElement("textarea");
	if(this.widget.editClass) this.dummyTextArea.className = this.widget.editClass;
	this.dummyTextArea.setAttribute("hidden","true");
	this.parentNode.insertBefore(this.dummyTextArea,this.nextSibling);
	this.widget.domNodes.push(this.dummyTextArea);

	// Wrapper
	this.wrapperNode = doc.createElement("div");
	this.wrapperNode.className = "tc-editor-wrapper";
	this.wrapperNode.style.position = "relative";
	this.parentNode.insertBefore(this.wrapperNode,this.nextSibling);
	this.widget.domNodes.push(this.wrapperNode);

	// Iframe
	this.iframeNode = doc.createElement("iframe");
	this.iframeNode.setAttribute("frameborder","0");
	this.iframeNode.setAttribute("scrolling","no");
	this.iframeNode.style.border = "none";
	this.iframeNode.style.display = "block";
	this.iframeNode.style.width = "100%";
	this.iframeNode.style.padding = "0";
	this.iframeNode.style.margin = "0";
	this.wrapperNode.appendChild(this.iframeNode);
	this.widget.domNodes.push(this.iframeNode);

	// Determine palette color-scheme (best-effort)
	var paletteTitle = this.widget.wiki.getTiddlerText("$:/palette");
	var colorScheme = (this.widget.wiki.getTiddler(paletteTitle) || {fields:{}}).fields["color-scheme"] || "light";
	var safeScheme = String(colorScheme).replace(/'/g,"&#39;");

	// Boot iframe document
	this.iframeDoc = (this.iframeNode.contentWindow && this.iframeNode.contentWindow.document) || doc;

	this.iframeDoc.open();
	this.iframeDoc.write([
		"<!DOCTYPE html>",
		"<html>",
		"<head>",
		"<meta charset='utf-8'>",
		"<meta name='color-scheme' content='" + safeScheme + "'>",
		"<meta name='viewport' content='width=device-width,initial-scale=1'>",
		"<style>",
		":root{",
			"--tc-editor-cursor:#3b82f6;",
			"--tc-editor-selection:rgba(59,130,246,0.30);",
			"--tc-editor-search-hit:rgba(255,210,80,0.35);",
			"--tc-editor-gutter-bg:rgba(0,0,0,0.03);",
			"--tc-editor-gutter-fg:rgba(0,0,0,0.55);",
			"--tc-editor-gutter-border:rgba(0,0,0,0.12);",
		"}",
		"*{box-sizing:border-box;}",
		"html,body{margin:0;padding:0;height:100%;}",
		"body{overflow:hidden;font:inherit;}",

		".tc-editor-container{",
			"position:relative;",
			"display:flex;",
			"flex-direction:row;",
			"width:100%;",
			"height:100%;",
		"}",

		".tc-editor-gutter{",
			"flex:0 0 auto;",
			"min-width:3em;",
			"padding:0 0.5em;",
			"text-align:right;",
			"font-family:inherit;",
			"font-size:inherit;",
			"line-height:inherit;",
			"background:var(--tc-editor-gutter-bg);",
			"color:var(--tc-editor-gutter-fg);",
			"border-right:1px solid var(--tc-editor-gutter-border);",
			"user-select:none;",
			"pointer-events:none;",
			"overflow:hidden;",
			"position:relative;",
			"display:none;",
		"}",

		".tc-editor-main{",
			"position:relative;",
			"flex:1 1 auto;",
			"min-width:0;",
			"height:100%;",
		"}",

		".tc-editor-main textarea,.tc-editor-main input{",
			"display:block;",
			"position:relative;",
			"z-index:1;",
			"width:100%;",
			"height:100%;",
			"margin:0;",
			"border:0;",
			"outline:none;",
			"background:transparent;",
			"resize:none;",
		"}",

		".tc-editor-main textarea{",
			"white-space:pre-wrap;",
			"word-break:normal;",
			"overflow-wrap:break-word;",
			"tab-size:4;",
			"-moz-tab-size:4;",
		"}",

		".tc-editor-overlay{",
			"position:absolute;",
			"top:0;",
			"left:0;",
			"right:0;",
			"bottom:0;",
			"pointer-events:none;",
			"overflow:hidden;",
			"z-index:2;",
			"transform:translate(0,0);",
		"}",
		".tc-editor-cursor-layer,.tc-editor-decoration-layer{",
			"position:absolute;",
			"top:0;",
			"left:0;",
			"right:0;",
			"bottom:0;",
		"}",

		".tc-cursor{",
			"position:absolute;",
			"width:2px;",
			"background:var(--tc-editor-cursor);",
			"animation:tc-cursor-blink 1s infinite;",
			"pointer-events:none;",
			"z-index:10;",
		"}",
		".tc-selection{",
			"position:absolute;",
			"background:var(--tc-editor-selection);",
			"pointer-events:none;",
			"z-index:9;",
		"}",
		"@keyframes tc-cursor-blink{0%,50%{opacity:1;}51%,100%{opacity:0;}}",

		"</style>",
		"</head>",
		"<body>",
			"<div class='tc-editor-container'>",
				"<div class='tc-editor-gutter'></div>",
				"<div class='tc-editor-main'></div>",
			"</div>",
		"</body>",
		"</html>"
	].join(""));
	this.iframeDoc.close();

	// Re-acquire references (post-write)
	this.iframeWin = this.iframeNode.contentWindow || (this.iframeDoc && this.iframeDoc.defaultView) || window;
	this.container = this.iframeDoc.querySelector(".tc-editor-container") || this.iframeDoc.body;
	this.gutterNode = this.iframeDoc.querySelector(".tc-editor-gutter");
	this.mainNode = this.iframeDoc.querySelector(".tc-editor-main") || this.container;

	// Inherit class for styling
	this.iframeNode.className = this.dummyTextArea.className;

	// Create textarea/input
	var tag = this.widget.editTag;
	if($tw.config.htmlUnsafeElements.indexOf(tag) !== -1) tag = "input";
	this.domNode = this.iframeDoc.createElement(tag);
	this.widget.domNodes.push(this.domNode);
	this.domNode.value = this.value;

	this.setAttributes();
	this.copyStyles();

	// Overlay structure (always present in framed engine)
	this.overlayNode = this.iframeDoc.createElement("div");
	this.overlayNode.className = "tc-editor-overlay";

	this.cursorLayer = this.iframeDoc.createElement("div");
	this.cursorLayer.className = "tc-editor-cursor-layer";

	this.decorationLayer = this.iframeDoc.createElement("div");
	this.decorationLayer.className = "tc-editor-decoration-layer";

	this.overlayNode.appendChild(this.cursorLayer);
	this.overlayNode.appendChild(this.decorationLayer);

	// Append to mainNode
	this.mainNode.appendChild(this.domNode);
	this.mainNode.appendChild(this.overlayNode);

	this.addEventListeners();
	this.fixHeight();
};

FramedEngine.prototype.setAttributes = function() {
	if(this.widget.editType && this.widget.editTag !== "textarea") this.domNode.setAttribute("type",this.widget.editType);
	if(this.widget.editPlaceholder) this.domNode.setAttribute("placeholder",this.widget.editPlaceholder);
	if(this.widget.editSize) this.domNode.setAttribute("size",this.widget.editSize);
	if(this.widget.editRows) this.domNode.setAttribute("rows",this.widget.editRows);
	if(this.widget.editAutoComplete) this.domNode.setAttribute("autocomplete",this.widget.editAutoComplete);

	if(this.widget.editSpellcheck !== undefined) this.domNode.setAttribute("spellcheck",this.widget.editSpellcheck === "yes" ? "true" : "false");
	if(this.widget.editWrap !== undefined && this.widget.editTag === "textarea") this.domNode.setAttribute("wrap",this.widget.editWrap);
	if(this.widget.editAutoCorrect !== undefined) this.domNode.setAttribute("autocorrect",this.widget.editAutoCorrect);
	if(this.widget.editAutoCapitalize !== undefined) this.domNode.setAttribute("autocapitalize",this.widget.editAutoCapitalize);
	if(this.widget.editInputMode !== undefined) this.domNode.setAttribute("inputmode",this.widget.editInputMode);
	if(this.widget.editEnterKeyHint !== undefined) this.domNode.setAttribute("enterkeyhint",this.widget.editEnterKeyHint);
	if(this.widget.editName !== undefined) this.domNode.setAttribute("name",this.widget.editName);
	if(this.widget.editDir !== undefined) this.domNode.setAttribute("dir",this.widget.editDir);
	if(this.widget.editLang !== undefined) this.domNode.setAttribute("lang",this.widget.editLang);

	if(this.widget.editAriaLabel !== undefined) this.domNode.setAttribute("aria-label",this.widget.editAriaLabel);
	if(this.widget.editAriaDescription !== undefined) this.domNode.setAttribute("aria-description",this.widget.editAriaDescription);

	if(this.widget.isDisabled === "yes") this.domNode.setAttribute("disabled",true);
	if(this.widget.editReadOnly === "yes") this.domNode.setAttribute("readonly",true);

	if(this.widget.editTabIndex) this.iframeNode.setAttribute("tabindex",this.widget.editTabIndex);
};

FramedEngine.prototype.copyStyles = function() {
	$tw.utils.copyStyles(this.dummyTextArea,this.domNode);
	this.domNode.style.display = "block";
	this.domNode.style.width = "100%";
	this.domNode.style.margin = "0";
	this.domNode.style.resize = "none";
	this.domNode.style["-webkit-text-fill-color"] = "currentcolor";
};

// ==================== LISTENERS / CLEANUP ====================

FramedEngine.prototype._on = function(target, name, handler, opts) {
	if(!target || !target.addEventListener) return;
	target.addEventListener(name, handler, opts || false);
	this._listeners.push({ target: target, name: name, handler: handler, opts: opts || false });
};

FramedEngine.prototype._clearListeners = function() {
	for(var i = 0; i < this._listeners.length; i++) {
		var l = this._listeners[i];
		try { l.target.removeEventListener(l.name, l.handler, l.opts); } catch(e) {}
	}
	this._listeners = [];
};

FramedEngine.prototype._setInterval = function(fn, ms) {
	var id = setInterval(fn, ms);
	this._intervals.push(id);
	return id;
};

FramedEngine.prototype._clearIntervals = function() {
	for(var i = 0; i < this._intervals.length; i++) {
		try { clearInterval(this._intervals[i]); } catch(e) {}
	}
	this._intervals = [];
};

FramedEngine.prototype.addEventListeners = function() {
	var self = this;

	this._on(this.domNode, "click", function(e){ self.handleClickEvent(e); });
	this._on(this.domNode, "input", function(e){ self.handleInputEvent(e); });
	this._on(this.domNode, "keydown", function(e){ self.handleKeydownEvent(e); });
	this._on(this.domNode, "keypress", function(e){ self.handleKeypressEvent(e); });
	this._on(this.domNode, "focus", function(e){ self.handleFocusEvent(e); });
	this._on(this.domNode, "blur", function(e){ self.handleBlurEvent(e); });
	this._on(this.domNode, "select", function(e){ self.handleSelectEvent(e); });
	this._on(this.domNode, "scroll", function(e){ self.handleScrollEvent(e); });

	// Undo capture + multi-cursor intercept
	this._on(this.domNode, "beforeinput", function(e){ self.handleBeforeInputEvent(e); });

	// IME safety
	this._on(this.domNode, "compositionstart", function(e){ self.handleCompositionStart(e); });
	this._on(this.domNode, "compositionend", function(e){ self.handleCompositionEnd(e); });

	// Selection change polling (textarea doesn't reliably fire 'select' for all caret moves)
	this._setInterval(function(){ self.checkSelectionChange(); }, 60);

	// Optional file drop
	if(this.widget.isFileDropEnabled) {
		this._on(this.domNode, "dragenter", function(e){ self.widget.handleDragEnterEvent(e); });
		this._on(this.domNode, "dragover", function(e){ self.widget.handleDragOverEvent(e); });
		this._on(this.domNode, "dragleave", function(e){ self.widget.handleDragLeaveEvent(e); });
		this._on(this.domNode, "dragend", function(e){ self.widget.handleDragEndEvent(e); });
		this._on(this.domNode, "drop", function(e){ self.widget.handleDropEvent(e); });
		this._on(this.domNode, "paste", function(e){ self.widget.handlePasteEvent(e); });
	}
};

// ==================== PLUGIN SYSTEM ====================

FramedEngine.prototype._normalizeSupports = function(supports) {
	supports = supports || {};
	return {
		simple: (supports.simple !== false),
		framed: (supports.framed !== false)
	};
};

FramedEngine.prototype._setFramedEnabledInMetadata = function(name, enabled, reason) {
	if(!name) return;
	var meta = this.pluginMetadata && this.pluginMetadata[name];
	if(!meta) return;
	if(!meta.supports) meta.supports = { simple: true, framed: true };
	if(!meta.framedEngine) meta.framedEngine = { supported: true, enabled: false, reason: "unknown" };
	meta.framedEngine.enabled = !!enabled;
	if(reason) meta.framedEngine.reason = reason;
};

FramedEngine.prototype.initializePlugins = function() {
	var self = this;

	$tw.modules.forEachModuleOfType("editor-plugin", function(title, module) {
		if(!module || !module.create) return;

		var supports = self._normalizeSupports(module.supports);

		// Metadata BEFORE instantiation
		var meta = {
			title: title,
			name: module.name || title.replace(/.*\//, "").replace(/\.js$/, ""),
			configTiddler: module.configTiddler || null,
			configTiddlerAlt: module.configTiddlerAlt || null,
			defaultEnabled: module.defaultEnabled !== undefined ? module.defaultEnabled : false,
			description: module.description || "",
			category: module.category || "general",

			// NEW
			supports: { simple: supports.simple, framed: supports.framed },
			framedEngine: {
				supported: supports.framed,
				enabled: false,
				reason: supports.framed ? "loaded" : "unsupported"
			}
		};

		// Store metadata even if skipped
		self.pluginMetadata[meta.name] = meta;

		// Skip unsupported framed plugins BEFORE create()
		if(!supports.framed) return;

		try {
			var plugin = module.create(self);
			if(plugin) {
				// Re-key metadata if plugin instance name differs
				var pluginName = plugin.name || meta.name;
				if(pluginName !== meta.name) {
					meta.name = pluginName;
					self.pluginMetadata[pluginName] = meta;
					try { delete self.pluginMetadata[title.replace(/.*\//, "").replace(/\.js$/, "")]; } catch(e) {}
				}

				plugin._meta = meta;
				self.registerPlugin(plugin, meta);

				self._setFramedEnabledInMetadata(pluginName, false, "registered");
			}
		} catch(e) {
			console.error("Failed to create editor plugin:", title, e);
		}
	});
};

FramedEngine.prototype.registerPlugin = function(plugin, meta) {
	this.plugins.push(plugin);

	var name = (plugin && plugin.name) || (meta && meta.name);
	if(name) this.pluginMetadata[name] = meta || this.pluginMetadata[name] || {};

	if(plugin.hooks) {
		for(var hookName in plugin.hooks) {
			if(this.hooks[hookName]) this.hooks[hookName].push({ plugin: plugin, handler: plugin.hooks[hookName] });
		}
	}

	if(plugin.onRegister) {
		try { plugin.onRegister(this); }
		catch(e) { console.error("Plugin onRegister error:", plugin.name, e); }
	}
};

FramedEngine.prototype.getPluginMetadata = function() { return this.pluginMetadata; };

FramedEngine.prototype.getPluginConfigTiddlers = function() {
	var tiddlers = [];
	for(var name in this.pluginMetadata) {
		var meta = this.pluginMetadata[name];
		if(meta.configTiddler) tiddlers.push(meta.configTiddler);
		if(meta.configTiddlerAlt) tiddlers.push(meta.configTiddlerAlt);
	}
	return tiddlers;
};

FramedEngine.prototype.hasPlugin = function(name) {
	for(var i = 0; i < this.plugins.length; i++) if(this.plugins[i] && this.plugins[i].name === name) return true;
	return false;
};

FramedEngine.prototype.getPlugin = function(name) {
	for(var i = 0; i < this.plugins.length; i++) if(this.plugins[i] && this.plugins[i].name === name) return this.plugins[i];
	return null;
};

FramedEngine.prototype.enablePlugin = function(name) {
	var meta = this.pluginMetadata && this.pluginMetadata[name];
	if(meta && meta.framedEngine && meta.framedEngine.supported === false) {
		this._setFramedEnabledInMetadata(name, false, "unsupported");
		return;
	}
	var plugin = this.getPlugin(name);
	if(plugin && plugin.enable) {
		try { plugin.enable(); }
		catch(e) { console.error("Plugin enable error:", name, e); }
	}
	this._setFramedEnabledInMetadata(name, true, "enabled");
};

FramedEngine.prototype.disablePlugin = function(name) {
	var plugin = this.getPlugin(name);
	if(plugin && plugin.disable) {
		try { plugin.disable(); }
		catch(e) { console.error("Plugin disable error:", name, e); }
	}
	this._setFramedEnabledInMetadata(name, false, "disabled");
};

FramedEngine.prototype.setPluginEnabled = function(name, enabled) {
	if(enabled) this.enablePlugin(name);
	else this.disablePlugin(name);
};

FramedEngine.prototype.enablePluginsByConfig = function(enabledMap) {
	for(var i = 0; i < this.plugins.length; i++) {
		var plugin = this.plugins[i];
		if(!plugin || !plugin.name) continue;

		var meta = this.pluginMetadata[plugin.name];
		var shouldEnable;

		if(enabledMap && enabledMap[plugin.name] !== undefined) {
			shouldEnable = (enabledMap[plugin.name] === "yes" || enabledMap[plugin.name] === true);
		} else {
			shouldEnable = meta ? !!meta.defaultEnabled : false;
		}

		this.setPluginEnabled(plugin.name, shouldEnable);
	}
};

FramedEngine.prototype.configurePlugin = function(name, options) {
	var plugin = this.getPlugin(name);
	if(plugin && plugin.configure) {
		try { plugin.configure(options); }
		catch(e) { console.error("Plugin configure error:", name, e); }
	}
};

FramedEngine.prototype.runHooks = function(hookName, event, data) {
	var hooks = this.hooks[hookName] || [];
	var result = { prevented: false, data: data };

	for(var i = 0; i < hooks.length; i++) {
		var h = hooks[i];
		try {
			var r = h.handler.call(h.plugin, event, result.data, this);
			if(r === false) { result.prevented = true; break; }
			if(r !== undefined && r !== true) result.data = r;
		} catch(e) {
			console.error("Hook error:", hookName, h.plugin && h.plugin.name, e);
		}
	}
	return result;
};

// ==================== CURSOR MANAGEMENT ====================

FramedEngine.prototype.getCursors = function() { return this.cursors; };

FramedEngine.prototype.getPrimaryCursor = function() {
	for(var i = 0; i < this.cursors.length; i++) if(this.cursors[i] && this.cursors[i].isPrimary) return this.cursors[i];
	return this.cursors[0];
};

FramedEngine.prototype.hasMultipleCursors = function() { return this.cursors.length > 1; };

FramedEngine.prototype.addCursor = function(position, selection) {
	var cursor = {
		id: "cursor-" + Date.now() + "-" + Math.random().toString(36).slice(2),
		start: selection ? selection.start : position,
		end: selection ? selection.end : position,
		isPrimary: false
	};
	this.cursors.push(cursor);
	this.sortAndMergeCursors();
	this.renderCursors();
	return cursor;
};

FramedEngine.prototype.removeCursor = function(id) {
	if(this.cursors.length <= 1) return;
	var out = [];
	for(var i = 0; i < this.cursors.length; i++) {
		var c = this.cursors[i];
		if(c.isPrimary || c.id !== id) out.push(c);
	}
	this.cursors = out;
	this.renderCursors();
};

FramedEngine.prototype.clearSecondaryCursors = function() {
	var out = [];
	for(var i = 0; i < this.cursors.length; i++) if(this.cursors[i] && this.cursors[i].isPrimary) out.push(this.cursors[i]);
	this.cursors = out.length ? out : [this.cursors[0]];
	this.renderCursors();
};

FramedEngine.prototype.sortAndMergeCursors = function() {
	if(!this.cursors || !this.cursors.length) return;

	// Normalize bounds
	for(var i = 0; i < this.cursors.length; i++) {
		var c = this.cursors[i];
		if(!c) continue;
		c.start = Math.max(0, c.start|0);
		c.end = Math.max(0, c.end|0);
		if(c.end < c.start) { var tmp = c.start; c.start = c.end; c.end = tmp; }
	}

	this.cursors.sort(function(a,b){ return a.start - b.start; });
	if(this.cursors.length < 2) {
		this.cursors[0].isPrimary = true;
		return;
	}

	var merged = [this.cursors[0]];
	for(i = 1; i < this.cursors.length; i++) {
		var cur = this.cursors[i];
		var last = merged[merged.length - 1];
		if(cur.start <= last.end) {
			last.end = Math.max(last.end, cur.end);
			last.isPrimary = last.isPrimary || cur.isPrimary;
		} else {
			merged.push(cur);
		}
	}
	this.cursors = merged;

	// Ensure exactly one primary
	var primaryIndex = -1;
	for(i = 0; i < this.cursors.length; i++) {
		if(this.cursors[i].isPrimary) { primaryIndex = i; break; }
	}
	if(primaryIndex === -1) primaryIndex = 0;
	for(i = 0; i < this.cursors.length; i++) this.cursors[i].isPrimary = (i === primaryIndex);
};

FramedEngine.prototype.mergeCursors = function() { this.sortAndMergeCursors(); };

FramedEngine.prototype.syncCursorFromDOM = function() {
	var primary = this.getPrimaryCursor();
	if(primary && this.domNode) {
		primary.start = this.domNode.selectionStart || 0;
		primary.end = this.domNode.selectionEnd || 0;
	}
	this.lastKnownSelection = {
		start: this.domNode.selectionStart || 0,
		end: this.domNode.selectionEnd || 0
	};
};

FramedEngine.prototype.syncDOMFromCursor = function() {
	var primary = this.getPrimaryCursor();
	if(primary && this.domNode && this.domNode.setSelectionRange) {
		try { this.domNode.setSelectionRange(primary.start, primary.end); } catch(e) {}
	}
};

// ==================== RENDER CURSORS ====================

FramedEngine.prototype.renderCursors = function() {
	if(!this.cursorLayer || !this.iframeDoc) return;

	this.cursorLayer.innerHTML = "";
	if(!this.hasMultipleCursors()) {
		this.runHooks("render", null, { layer: this.cursorLayer, decorationLayer: this.decorationLayer });
		return;
	}

	var self = this;

	for(var i = 0; i < this.cursors.length; i++) {
		var cursor = this.cursors[i];
		if(!cursor || cursor.isPrimary) continue;

		if(cursor.start !== cursor.end) {
			var rects = self.getRectsForRange(cursor.start, cursor.end);
			for(var j = 0; j < rects.length; j++) {
				var r = rects[j];
				var selEl = self.iframeDoc.createElement("div");
				selEl.className = "tc-selection";
				selEl.style.left = r.left + "px";
				selEl.style.top = r.top + "px";
				selEl.style.width = r.width + "px";
				selEl.style.height = r.height + "px";
				self.cursorLayer.appendChild(selEl);
			}
		}

		var caret = self.getCoordinatesForPosition(cursor.end);
		if(caret) {
			var cEl = self.iframeDoc.createElement("div");
			cEl.className = "tc-cursor";
			cEl.style.left = caret.left + "px";
			cEl.style.top = caret.top + "px";
			cEl.style.height = caret.height + "px";
			self.cursorLayer.appendChild(cEl);
		}
	}

	this.runHooks("render", null, { layer: this.cursorLayer, decorationLayer: this.decorationLayer });
};

// ==================== GEOMETRY (CARET / RECTS) ====================

FramedEngine.prototype.getCoordinatesForPosition = function(position) {
	var textarea = this.domNode;
	var doc = this.iframeDoc;
	var win = this.iframeWin;
	if(!textarea || !doc || !win) return null;

	var text = textarea.value || "";
	position = Math.max(0, Math.min(position, text.length));

	var cs = win.getComputedStyle(textarea);

	// Mirror element (like simple engine, but inside iframe)
	var mirror = doc.createElement("div");
	mirror.style.position = "absolute";
	mirror.style.visibility = "hidden";
	mirror.style.whiteSpace = "pre-wrap";
	mirror.style.wordWrap = "break-word";
	mirror.style.overflowWrap = cs.overflowWrap || "break-word";
	mirror.style.wordBreak = cs.wordBreak || "normal";
	mirror.style.boxSizing = cs.boxSizing || "content-box";
	mirror.style.width = textarea.clientWidth + "px";

	var props = [
		"fontFamily","fontSize","fontWeight","fontStyle","letterSpacing",
		"textTransform","wordSpacing","textIndent","lineHeight","tabSize",
		"paddingTop","paddingRight","paddingBottom","paddingLeft",
		"borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth"
	];
	for(var i = 0; i < props.length; i++) mirror.style[props[i]] = cs[props[i]];

	function esc(s){
		return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
	}

	var before = esc(text.slice(0, position));
	before = before.replace(/\n$/,"\n\u200b");
	before = before.replace(/\n/g,"<br/>");
	before = before.replace(/\t/g,"<span style=\"white-space:pre\">\t</span>");

	var marker = doc.createElement("span");
	marker.textContent = "\u200b";

	mirror.innerHTML = before;
	mirror.appendChild(marker);

	// Append near textarea to inherit layout context
	var host = textarea.parentNode || doc.body || doc.documentElement;
	if(!host) return null;
	host.appendChild(mirror);

	var markerRect = marker.getBoundingClientRect();
	var mirrorRect = mirror.getBoundingClientRect();

	try { host.removeChild(mirror); } catch(e) {}

	// Convert to textarea content coords and correct for textarea scrolling
	var scrollTop = textarea.scrollTop || 0;
	var scrollLeft = textarea.scrollLeft || 0;

	var relLeft = (markerRect.left - mirrorRect.left) - scrollLeft;
	var relTop = (markerRect.top - mirrorRect.top) - scrollTop;

	var lh = parseFloat(cs.lineHeight);
	var h = (isFinite(lh) && lh > 0) ? lh : (markerRect.height || 16);

	return { left: relLeft, top: relTop, height: h };
};

FramedEngine.prototype.getRectsForRange = function(start, end) {
	// Lightweight rect approximation:
	// - accurate for single-line
	// - for multi-line: first line to end, middle full lines, last line to caret
	var s = this.getCoordinatesForPosition(start);
	var e = this.getCoordinatesForPosition(end);
	if(!s || !e) return [];

	var lineHeight = s.height || e.height || 16;

	if(Math.abs(s.top - e.top) < lineHeight * 0.5) {
		return [{
			left: s.left,
			top: s.top,
			width: Math.max(e.left - s.left, 2),
			height: lineHeight
		}];
	}

	var win = this.iframeWin;
	var cs = win.getComputedStyle(this.domNode);
	var paddingLeft = parseFloat(cs.paddingLeft) || 0;
	var paddingRight = parseFloat(cs.paddingRight) || 0;
	var contentWidth = Math.max(0, this.domNode.clientWidth - paddingLeft - paddingRight);

	var rects = [];

	// First line
	rects.push({
		left: s.left,
		top: s.top,
		width: Math.max((paddingLeft + contentWidth) - s.left, 2),
		height: lineHeight
	});

	// Middle lines
	var y = s.top + lineHeight;
	while(y + lineHeight <= e.top) {
		rects.push({
			left: paddingLeft,
			top: y,
			width: Math.max(contentWidth, 2),
			height: lineHeight
		});
		y += lineHeight;
	}

	// Last line
	rects.push({
		left: paddingLeft,
		top: e.top,
		width: Math.max(e.left - paddingLeft, 2),
		height: lineHeight
	});

	return rects;
};

// ==================== UNDO SYSTEM ====================

FramedEngine.prototype.initializeUndoSystem = function() {
	this.undoStack = [];
	this.redoStack = [];
	this.pendingBeforeState = null;
	this.lastUndoTime = 0;
	this.undoGroupingDelay = 500;
	this.isUndoRedoOperation = false;
	this.lastSavedState = this.createState();
};

FramedEngine.prototype.createState = function() {
	return {
		text: this.domNode ? (this.domNode.value || "") : (this.value || ""),
		cursors: JSON.parse(JSON.stringify(this.cursors)),
		selectionStart: this.domNode ? this.domNode.selectionStart : 0,
		selectionEnd: this.domNode ? this.domNode.selectionEnd : 0,
		timestamp: Date.now()
	};
};

FramedEngine.prototype.captureBeforeState = function() {
	if(this.isUndoRedoOperation) return;
	if(!this.pendingBeforeState) this.pendingBeforeState = this.createState();
};

FramedEngine.prototype.recordUndo = function(forceSeparate) {
	if(this.isUndoRedoOperation) return;

	var now = Date.now();
	var currentText = this.domNode.value;
	var beforeState = this.pendingBeforeState || this.lastSavedState;
	this.pendingBeforeState = null;

	if(!beforeState || currentText === beforeState.text) return;

	var afterState = this.createState();

	var shouldGroup =
		!forceSeparate &&
		this.undoStack.length > 0 &&
		(now - this.lastUndoTime) < this.undoGroupingDelay &&
		this.lastUndoTime > 0;

	if(shouldGroup) {
		this.undoStack[this.undoStack.length - 1].after = afterState;
	} else {
		this.undoStack.push({ before: beforeState, after: afterState });
		if(this.undoStack.length > 200) this.undoStack.shift();
	}

	this.lastSavedState = afterState;
	this.redoStack = [];
	this.lastUndoTime = forceSeparate ? 0 : now;
};

FramedEngine.prototype.applyState = function(state) {
	if(!state) return;

	this.domNode.value = state.text;
	this.lastKnownText = state.text;

	if(state.cursors && state.cursors.length) {
		this.cursors = JSON.parse(JSON.stringify(state.cursors));
		this.sortAndMergeCursors();
		this.syncDOMFromCursor();
	} else {
		try { this.domNode.setSelectionRange(state.selectionStart || 0, state.selectionEnd || 0); } catch(e) {}
		this.syncCursorFromDOM();
	}

	this.renderCursors();
	this.fixHeight();
	this.widget.saveChanges(this.getText());
};

FramedEngine.prototype.undo = function() {
	if(!this.undoStack.length) return false;
	this.pendingBeforeState = null;
	this.isUndoRedoOperation = true;
	try {
		var entry = this.undoStack.pop();
		this.redoStack.push(entry);
		this.applyState(entry.before);
		this.lastSavedState = entry.before;
	} finally {
		this.isUndoRedoOperation = false;
	}
	return true;
};

FramedEngine.prototype.redo = function() {
	if(!this.redoStack.length) return false;
	this.pendingBeforeState = null;
	this.isUndoRedoOperation = true;
	try {
		var entry = this.redoStack.pop();
		this.undoStack.push(entry);
		this.applyState(entry.after);
		this.lastSavedState = entry.after;
	} finally {
		this.isUndoRedoOperation = false;
	}
	return true;
};

FramedEngine.prototype.canUndo = function(){ return this.undoStack.length > 0; };
FramedEngine.prototype.canRedo = function(){ return this.redoStack.length > 0; };

// ==================== TEXT OPERATIONS ====================

FramedEngine.prototype.insertAtAllCursors = function(insertText) {
	if(insertText === undefined || insertText === null) return;
	insertText = String(insertText);

	this.captureBeforeState();

	var text = this.domNode.value;

	// Apply from right to left to preserve indices
	var sortedDesc = this.cursors.slice().sort(function(a,b){ return b.start - a.start; });
	for(var i = 0; i < sortedDesc.length; i++) {
		var c = sortedDesc[i];
		text = text.substring(0, c.start) + insertText + text.substring(c.end);
	}

	// Move cursors (left to right)
	var sortedAsc = this.cursors.slice().sort(function(a,b){ return a.start - b.start; });
	var cumulative = 0;
	for(i = 0; i < sortedAsc.length; i++) {
		c = sortedAsc[i];
		var deleted = c.end - c.start;
		var newPos = c.start + cumulative + insertText.length;
		c.start = newPos;
		c.end = newPos;
		cumulative += insertText.length - deleted;
	}

	this.domNode.value = text;
	this.lastKnownText = text;

	this.sortAndMergeCursors();
	this.syncDOMFromCursor();
	this.renderCursors();

	this.recordUndo(true);
	this.widget.saveChanges(text);
	this.fixHeight();
};

FramedEngine.prototype.deleteAtAllCursors = function(forward) {
	this.captureBeforeState();

	var text = this.domNode.value;
	var sortedDesc = this.cursors.slice().sort(function(a,b){ return b.start - a.start; });

	var deletions = [];
	for(var i = 0; i < sortedDesc.length; i++) {
		var c = sortedDesc[i];
		var start = c.start;
		var end = c.end;

		if(start === end) {
			if(forward) {
				if(end >= text.length) continue;
				end++;
			} else {
				if(start <= 0) continue;
				start--;
			}
		}

		text = text.substring(0, start) + text.substring(end);
		deletions.push({ id: c.id, at: start, len: end - start });
	}

	// Reposition cursors
	var sortedAsc = this.cursors.slice().sort(function(a,b){ return a.start - b.start; });
	var cumulative = 0;
	for(i = 0; i < sortedAsc.length; i++) {
		c = sortedAsc[i];
		var d = null;
		for(var j = 0; j < deletions.length; j++) if(deletions[j].id === c.id) { d = deletions[j]; break; }
		if(!d) continue;

		var newPos = Math.max(0, d.at + cumulative);
		c.start = newPos;
		c.end = newPos;
		cumulative -= d.len;
	}

	this.domNode.value = text;
	this.lastKnownText = text;

	this.sortAndMergeCursors();
	this.syncDOMFromCursor();
	this.renderCursors();

	this.recordUndo(true);
	this.widget.saveChanges(text);
	this.fixHeight();
};

FramedEngine.prototype.setText = function(text,type) {
	if(this.domNode && !this.domNode.isTiddlyWikiFakeDom) {
		if(this.iframeDoc.activeElement !== this.domNode) {
			this.updateDomNodeText(text);
		}
		this.fixHeight();
	}
};

FramedEngine.prototype.updateDomNodeText = function(text) {
	try {
		this.domNode.value = text;
		this.lastKnownText = text;
	} catch(e) {}
};

FramedEngine.prototype.getText = function() { return this.domNode.value; };

FramedEngine.prototype.createTextOperation = function() {
	this.syncCursorFromDOM();
	var text = this.domNode.value;
	var ops = [];

	if(!this.cursors || this.cursors.length === 0) {
		this.cursors = [{
			id: "primary",
			start: this.domNode.selectionStart || 0,
			end: this.domNode.selectionEnd || 0,
			isPrimary: true
		}];
	}

	var sorted = this.cursors.slice().sort(function(a,b){ return a.start - b.start; });
	for(var i = 0; i < sorted.length; i++) {
		var c = sorted[i];
		var start = c.start || 0;
		var end = c.end || start;
		ops.push({
			text: text,
			selStart: start,
			selEnd: end,
			selection: text.substring(start, end),
			cutStart: null,
			cutEnd: null,
			replacement: null,
			newSelStart: null,
			newSelEnd: null,
			cursorId: c.id,
			cursorIndex: i
		});
	}

	// Back-compat for old single-cursor ops (properties on array)
	if(ops.length >= 1) {
		var o = ops[0];
		ops.text = o.text;
		ops.selStart = o.selStart;
		ops.selEnd = o.selEnd;
		ops.selection = o.selection;
		ops.cutStart = null;
		ops.cutEnd = null;
		ops.replacement = null;
		ops.newSelStart = null;
		ops.newSelEnd = null;
	}
	return ops;
};

FramedEngine.prototype.executeTextOperation = function(operations) {
	var opArray = Array.isArray(operations) ? operations : [operations];

	// Back-compat: properties set on the array (when length 1)
	if(Array.isArray(operations) && operations.length === 1) {
		var op0 = operations[0];
		if(operations.replacement !== null && operations.replacement !== undefined) op0.replacement = operations.replacement;
		if(operations.cutStart !== null && operations.cutStart !== undefined) op0.cutStart = operations.cutStart;
		if(operations.cutEnd !== null && operations.cutEnd !== undefined) op0.cutEnd = operations.cutEnd;
		if(operations.newSelStart !== null && operations.newSelStart !== undefined) op0.newSelStart = operations.newSelStart;
		if(operations.newSelEnd !== null && operations.newSelEnd !== undefined) op0.newSelEnd = operations.newSelEnd;
	}

	var active = [];
	for(var i = 0; i < opArray.length; i++) if(opArray[i] && opArray[i].replacement !== null && opArray[i].replacement !== undefined) active.push(opArray[i]);
	if(!active.length) return this.domNode.value;

	var hookResult = this.runHooks("beforeOperation", null, opArray);
	if(hookResult.prevented) return this.domNode.value;

	opArray = hookResult.data;
	active = [];
	for(i = 0; i < opArray.length; i++) if(opArray[i] && opArray[i].replacement !== null && opArray[i].replacement !== undefined) active.push(opArray[i]);
	if(!active.length) return this.domNode.value;

	this.captureBeforeState();

	// Apply descending by cutStart so indices remain valid
	active.sort(function(a,b){ return ((b.cutStart != null ? b.cutStart : b.selStart) || 0) - ((a.cutStart != null ? a.cutStart : a.selStart) || 0); });

	var text = this.domNode.value;
	var updates = [];

	for(i = 0; i < active.length; i++) {
		var op = active[i];

		var cutStart = (op.cutStart !== null && op.cutStart !== undefined) ? op.cutStart : op.selStart;
		var cutEnd = (op.cutEnd !== null && op.cutEnd !== undefined) ? op.cutEnd : op.selEnd;
		cutStart = Math.max(0, Math.min(cutStart, text.length));
		cutEnd = Math.max(cutStart, Math.min(cutEnd, text.length));

		var repl = String(op.replacement);

		text = text.substring(0, cutStart) + repl + text.substring(cutEnd);

		var newSelStart = (op.newSelStart !== null && op.newSelStart !== undefined) ? op.newSelStart : (cutStart + repl.length);
		var newSelEnd = (op.newSelEnd !== null && op.newSelEnd !== undefined) ? op.newSelEnd : newSelStart;

		updates.push({
			cursorId: op.cursorId,
			cutStart: cutStart,
			newStart: newSelStart,
			newEnd: newSelEnd,
			delta: repl.length - (cutEnd - cutStart)
		});
	}

	this.domNode.value = text;
	this.lastKnownText = text;

	this.updateCursorsAfterMultiOperation(updates);
	this.syncDOMFromCursor();
	this.renderCursors();

	this.recordUndo(true);

	this.runHooks("afterOperation", null, opArray);

	this.widget.saveChanges(text);
	this.fixHeight();

	return text;
};

FramedEngine.prototype.updateCursorsAfterMultiOperation = function(updates) {
	var sorted = updates.slice().sort(function(a,b){ return a.cutStart - b.cutStart; });

	for(var i = 0; i < this.cursors.length; i++) {
		var c = this.cursors[i];
		var u = null;
		for(var j = 0; j < updates.length; j++) if(updates[j].cursorId === c.id) { u = updates[j]; break; }
		if(!u) continue;

		var offset = 0;
		for(j = 0; j < sorted.length; j++) {
			if(sorted[j].cutStart < u.cutStart) offset += sorted[j].delta;
			else break;
		}

		c.start = u.newStart + offset;
		c.end = u.newEnd + offset;
	}

	this.sortAndMergeCursors();
};

FramedEngine.prototype.clearDecorations = function(ownerId) {
	if(!this.decorationLayer) return;
	if(!ownerId) {
		this.decorationLayer.innerHTML = "";
		return;
	}
	var nodes = this.decorationLayer.querySelectorAll("[data-owner]");
	for(var i = 0; i < nodes.length; i++) {
		if(nodes[i].getAttribute("data-owner") === ownerId) {
			if(nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
		}
	}
};

// ==================== EVENT HANDLERS ====================

FramedEngine.prototype.handleCompositionStart = function(event) {
	if(this._destroyed) return;
	this.isComposing = true;

	// Multi-cursor + IME is a mess: normalize to single cursor
	if(this.hasMultipleCursors()) this.clearSecondaryCursors();
	this.captureBeforeState();
};

FramedEngine.prototype.handleCompositionEnd = function(event) {
	if(this._destroyed) return;
	this.isComposing = false;

	this.syncCursorFromDOM();
	this.lastKnownText = this.domNode.value;

	this.recordUndo(true);
	this.widget.saveChanges(this.getText());
	this.fixHeight();
};

FramedEngine.prototype.handleBeforeInputEvent = function(event) {
	if(this._destroyed) return;

	this.lastKnownText = this.domNode.value;
	this.lastKnownSelection = { start: this.domNode.selectionStart, end: this.domNode.selectionEnd };

	this.captureBeforeState();

	var hookResult = this.runHooks("beforeInput", event, { inputType: event.inputType, data: event.data });
	if(hookResult.prevented) {
		event.preventDefault();
		this.pendingBeforeState = null;
		return;
	}

	// During IME composition, do not intercept – let the browser handle it
	if(this.isComposing) return;

	// Multi-cursor intercept for core editing actions
	if(this.hasMultipleCursors()) {
		switch(event.inputType) {
			case "insertText":
				event.preventDefault();
				if(event.data !== null && event.data !== undefined) this.insertAtAllCursors(event.data);
				return;

			case "insertLineBreak":
			case "insertParagraph":
				event.preventDefault();
				this.insertAtAllCursors("\n");
				return;

			case "deleteContentBackward":
			case "deleteByCut":
				event.preventDefault();
				this.deleteAtAllCursors(false);
				return;

			case "deleteContentForward":
				event.preventDefault();
				this.deleteAtAllCursors(true);
				return;

			case "insertFromPaste":
				// Some browsers provide data on beforeinput; if so, we can handle it
				if(event.data !== null && event.data !== undefined) {
					event.preventDefault();
					this.insertAtAllCursors(event.data);
					return;
				}
				break;

			default:
				break;
		}
	}
};

FramedEngine.prototype.handleInputEvent = function(event) {
	if(this._destroyed) return false;

	this.syncCursorFromDOM();

	// If somehow multi-cursor survived into a normal input event, normalize
	if(this.hasMultipleCursors() && !this.isComposing) {
		// If browser applied edit to primary only, it desyncs. Best safe behavior: collapse to single.
		this.clearSecondaryCursors();
	}

	this.lastKnownText = this.domNode.value;

	this.recordUndo(false);

	this.runHooks("afterInput", event, null);

	this.widget.saveChanges(this.getText());
	this.fixHeight();

	if(this.widget.editInputActions) {
		this.widget.invokeActionString(this.widget.editInputActions,this,event,{
			actionValue: this.getText()
		});
	}

	return true;
};

FramedEngine.prototype.isModifyingKey = function(event) {
	if(event.key === "Backspace" || event.key === "Delete") return true;
	if((event.ctrlKey || event.metaKey) && (String(event.key).toLowerCase() === "x" || String(event.key).toLowerCase() === "v")) return true;
	return false;
};

FramedEngine.prototype.handleKeydownEvent = function(event) {
	if(this._destroyed) return false;

	this.lastKnownText = this.domNode.value;
	this.lastKnownSelection = { start: this.domNode.selectionStart, end: this.domNode.selectionEnd };

	if(this.isModifyingKey(event)) this.captureBeforeState();

	var hookResult = this.runHooks("beforeKeydown", event, null);
	if(hookResult.prevented) {
		event.preventDefault();
		return true;
	}

	// Undo/redo
	if((event.ctrlKey || event.metaKey) && !event.altKey) {
		var k = String(event.key).toLowerCase();
		if(!event.shiftKey && k === "z") { event.preventDefault(); this.undo(); return true; }
		if((!event.shiftKey && k === "y") || (event.shiftKey && k === "z")) { event.preventDefault(); this.redo(); return true; }
	}

	// Escape collapses multi-cursor
	if(event.key === "Escape" && this.hasMultipleCursors()) {
		this.clearSecondaryCursors();
	}

	// Keyboard manager (TW core)
	if($tw.keyboardManager.handleKeydownEvent(event,{onlyPriority:true})) {
		return true;
	}

	var result = this.widget.handleKeydownEvent(event);

	this.runHooks("afterKeydown", event, null);

	return result;
};

FramedEngine.prototype.handleKeypressEvent = function(event) {
	if(this._destroyed) return false;

	var hookResult = this.runHooks("beforeKeypress", event, { isKeypress:true });
	if(hookResult.prevented) {
		event.preventDefault();
		return true;
	}

	var after = this.runHooks("afterKeypress", event, null);
	if(after.prevented) {
		event.preventDefault();
		return true;
	}
	return false;
};

FramedEngine.prototype.handleClickEvent = function(event) {
	if(this._destroyed) return false;

	var before = this.runHooks("beforeClick", event, {
		ctrlKey: !!(event && (event.ctrlKey || event.metaKey)),
		shiftKey: !!(event && event.shiftKey),
		altKey: !!(event && event.altKey)
	});
	if(before.prevented) {
		if(event && event.preventDefault) event.preventDefault();
		return true;
	}

	this.syncCursorFromDOM();
	this.lastKnownText = this.domNode.value;
	this.lastKnownSelection = { start: this.domNode.selectionStart, end: this.domNode.selectionEnd };

	this.fixHeight();

	this.runHooks("afterClick", event, null);

	return true;
};

FramedEngine.prototype.handleFocusEvent = function(event) {
	if(this._destroyed) return;
	if(this.widget.editCancelPopups) $tw.popup.cancel(0);
	this.runHooks("focus", event, null);
};

FramedEngine.prototype.handleBlurEvent = function(event) {
	if(this._destroyed) return;
	this.runHooks("blur", event, null);
};

FramedEngine.prototype.handleSelectEvent = function(event) {
	if(this._destroyed) return;
	this.syncCursorFromDOM();
	this.lastKnownSelection = { start: this.domNode.selectionStart, end: this.domNode.selectionEnd };
	this.runHooks("selectionChange", event, null);
};

FramedEngine.prototype.checkSelectionChange = function() {
	if(this._destroyed) return;
	if(!this.domNode || !this.iframeNode || !this.iframeNode.isConnected) return;

	var primary = this.getPrimaryCursor();
	if(!primary) return;

	var s = this.domNode.selectionStart;
	var e = this.domNode.selectionEnd;

	if(s !== primary.start || e !== primary.end) {
		this.syncCursorFromDOM();
		this.lastKnownSelection = { start: s, end: e };
		this.runHooks("selectionChange", null, null);
	}
};

FramedEngine.prototype.handleScrollEvent = function(event) {
	if(this._destroyed) return;

	// Overlay stays aligned with the scrolled textarea content
	if(this.overlayNode && this.domNode) {
		this.overlayNode.style.transform =
			"translate(-" + (this.domNode.scrollLeft || 0) + "px, -" + (this.domNode.scrollTop || 0) + "px)";
	}

	this.renderCursors();
};

// ==================== UTIL ====================

FramedEngine.prototype.fixHeight = function() {
	this.copyStyles();

	if(this.widget.editTag === "textarea" && !this.widget.editRows) {
		if(this.widget.editAutoHeight) {
			if(this.domNode && !this.domNode.isTiddlyWikiFakeDom) {
				var newHeight = $tw.utils.resizeTextAreaToFit(this.domNode, this.widget.editMinHeight);
				this.iframeNode.style.height = newHeight + "px";
			}
		} else {
			var fixedHeight = parseInt(this.widget.wiki.getTiddlerText(HEIGHT_VALUE_TITLE,"400px"),10);
			fixedHeight = Math.max(fixedHeight, 20);
			this.domNode.style.height = fixedHeight + "px";
			this.iframeNode.style.height = fixedHeight + "px";
		}
	}
};

FramedEngine.prototype.focus = function() {
	if(this.domNode && this.domNode.focus) this.domNode.focus();
	if(this.domNode && this.domNode.select) {
		$tw.utils.setSelectionByPosition(
			this.domNode,
			this.widget.editFocusSelectFromStart,
			this.widget.editFocusSelectFromEnd
		);
	}
};

FramedEngine.prototype.refocus = function() {
	if(this.domNode && this.domNode.focus) this.domNode.focus();
};

FramedEngine.prototype.saveChanges = function() {
	this.widget.saveChanges(this.getText());
};

FramedEngine.prototype.dispatchEvent = function(eventInfo) {
	this.widget.dispatchEvent(eventInfo);
};

// ==================== HELPERS (LINE/WORD) ====================

FramedEngine.prototype.getLineInfo = function(position) {
	var text = this.domNode.value || "";
	position = Math.max(0, Math.min(position, text.length));

	var before = text.substring(0, position);
	var linesBefore = before.split("\n");
	var allLines = text.split("\n");
	var lineNumber = linesBefore.length - 1;

	return {
		line: lineNumber,
		column: linesBefore[linesBefore.length - 1].length,
		lineStart: position - linesBefore[linesBefore.length - 1].length,
		lineText: allLines[lineNumber] || "",
		lineCount: allLines.length
	};
};

FramedEngine.prototype.getPositionForLineColumn = function(line, column) {
	var text = this.domNode.value || "";
	var lines = text.split("\n");
	line = Math.max(0, Math.min(line, lines.length - 1));

	var pos = 0;
	for(var i = 0; i < line; i++) pos += lines[i].length + 1;

	column = Math.max(0, Math.min(column, lines[line].length));
	return pos + column;
};

FramedEngine.prototype.getWordBoundsAt = function(position) {
	var text = this.domNode.value || "";
	var start = position, end = position;

	while(start > 0 && /\w/.test(text[start - 1])) start--;
	while(end < text.length && /\w/.test(text[end])) end++;

	return { start: start, end: end, word: text.substring(start, end) };
};

// ==================== API ====================

FramedEngine.prototype.getDocument = function(){ return this.iframeDoc; };
FramedEngine.prototype.getWindow = function(){ return this.iframeWin; };
FramedEngine.prototype.getWrapperNode = function(){ return this.wrapperNode; };
FramedEngine.prototype.getOverlayLayer = function(){ return this.overlayNode; };
FramedEngine.prototype.getDecorationLayer = function(){ return this.decorationLayer; };
FramedEngine.prototype.getCursorLayer = function(){ return this.cursorLayer; };

// ==================== DESTROY ====================

FramedEngine.prototype.destroy = function() {
	if(this._destroyed) return;
	this._destroyed = true;

	this._clearIntervals();
	this._clearListeners();

	for(var i = 0; i < this.plugins.length; i++) {
		var plugin = this.plugins[i];
		if(plugin && plugin.destroy) {
			try { plugin.destroy(); }
			catch(e) { console.error("Plugin destroy error:", plugin.name, e); }
		}
	}

	this.plugins = [];
	this.pluginMetadata = {};
	this.hooks = {};
	this.cursors = [];
	this.undoStack = [];
	this.redoStack = [];
	this.pendingBeforeState = null;
};

exports.FramedEngine = FramedEngine;
