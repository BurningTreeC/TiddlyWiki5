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

\*/

"use strict";

var HEIGHT_VALUE_TITLE = "$:/config/TextEditor/EditorHeight/Height";

function FramedEngine(options) {
	options = options || {};
	this.widget = options.widget;
	this.value = options.value || "";
	this.parentNode = options.parentNode;
	this.nextSibling = options.nextSibling;

	this.plugins = [];
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

FramedEngine.prototype.createDOM = function() {
	var doc = this.widget.document;

	this.dummyTextArea = doc.createElement("textarea");
	if(this.widget.editClass) this.dummyTextArea.className = this.widget.editClass;
	this.dummyTextArea.setAttribute("hidden","true");
	this.parentNode.insertBefore(this.dummyTextArea,this.nextSibling);
	this.widget.domNodes.push(this.dummyTextArea);

	this.wrapperNode = doc.createElement("div");
	this.wrapperNode.className = "tc-editor-wrapper";
	this.wrapperNode.style.position = "relative";
	this.parentNode.insertBefore(this.wrapperNode,this.nextSibling);
	this.widget.domNodes.push(this.wrapperNode);

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

	var paletteTitle = this.widget.wiki.getTiddlerText("$:/palette");
	var colorScheme = (this.widget.wiki.getTiddler(paletteTitle) || {fields:{}}).fields["color-scheme"] || "light";

	this.iframeDoc = this.iframeNode.contentWindow && this.iframeNode.contentWindow.document;
	if(!this.iframeDoc) this.iframeDoc = doc;

	var safeScheme = String(colorScheme).replace(/'/g,"&#39;");

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

		/* Layout: gutter + main editor side by side */
		".tc-editor-container{",
			"position:relative;",
			"display:flex;",
			"flex-direction:row;",
			"width:100%;",
			"height:100%;",
		"}",

		/* Gutter for line numbers */
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
			"display:none;",  /* Hidden by default, shown when line-numbers enabled */
		"}",

		/* Main editor area */
		".tc-editor-main{",
			"position:relative;",
			"flex:1 1 auto;",
			"min-width:0;",
			"height:100%;",
		"}",

		/* Textarea styles */
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

		/* Overlay for cursors and decorations */
		".tc-editor-overlay{",
			"position:absolute;",
			"top:0;",
			"left:0;",
			"right:0;",
			"bottom:0;",
			"pointer-events:none;",
			"overflow:hidden;",
			"z-index:2;",
		"}",
		".tc-editor-cursor-layer,.tc-editor-decoration-layer{",
			"position:absolute;",
			"top:0;",
			"left:0;",
			"right:0;",
			"bottom:0;",
		"}",

		/* Multi-cursor styles */
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

	// Get references to container elements
	this.container = this.iframeDoc.querySelector(".tc-editor-container") || this.iframeDoc.body;
	this.gutterNode = this.iframeDoc.querySelector(".tc-editor-gutter");
	this.mainNode = this.iframeDoc.querySelector(".tc-editor-main");
	
	// Fallback if main doesn't exist
	if(!this.mainNode) {
		this.mainNode = this.iframeDoc.createElement("div");
		this.mainNode.className = "tc-editor-main";
		this.container.appendChild(this.mainNode);
	}

	this.iframeNode.className = this.dummyTextArea.className;

	// Create textarea
	var tag = this.widget.editTag;
	if($tw.config.htmlUnsafeElements.indexOf(tag) !== -1) tag = "input";

	this.domNode = this.iframeDoc.createElement(tag);
	this.widget.domNodes.push(this.domNode);
	this.domNode.value = this.value;

	this.setAttributes();
	this.copyStyles();

	// Create overlay structure
	this.overlayNode = this.iframeDoc.createElement("div");
	this.overlayNode.className = "tc-editor-overlay";

	this.cursorLayer = this.iframeDoc.createElement("div");
	this.cursorLayer.className = "tc-editor-cursor-layer";

	this.decorationLayer = this.iframeDoc.createElement("div");
	this.decorationLayer.className = "tc-editor-decoration-layer";

	this.overlayNode.appendChild(this.cursorLayer);
	this.overlayNode.appendChild(this.decorationLayer);

	// FIXED: Append to mainNode, not container!
	this.mainNode.appendChild(this.domNode);
	this.mainNode.appendChild(this.overlayNode);

	this.addEventListeners();
	this.fixHeight();
};

FramedEngine.prototype.setAttributes = function() {
	if(this.widget.editType && this.widget.editTag !== "textarea") {
		this.domNode.setAttribute("type",this.widget.editType);
	}

	if(this.widget.editPlaceholder) this.domNode.setAttribute("placeholder",this.widget.editPlaceholder);
	if(this.widget.editSize) this.domNode.setAttribute("size",this.widget.editSize);
	if(this.widget.editRows) this.domNode.setAttribute("rows",this.widget.editRows);
	if(this.widget.editAutoComplete) this.domNode.setAttribute("autocomplete",this.widget.editAutoComplete);

	if(this.widget.editSpellcheck !== undefined) {
		this.domNode.setAttribute("spellcheck",this.widget.editSpellcheck === "yes" ? "true" : "false");
	}
	if(this.widget.editWrap !== undefined && this.widget.editTag === "textarea") {
		this.domNode.setAttribute("wrap",this.widget.editWrap);
	}
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

	if(this.widget.editTabIndex) {
		this.iframeNode.setAttribute("tabindex",this.widget.editTabIndex);
	}
};

FramedEngine.prototype.copyStyles = function() {
	$tw.utils.copyStyles(this.dummyTextArea,this.domNode);

	this.domNode.style.display = "block";
	this.domNode.style.width = "100%";
	this.domNode.style.margin = "0";
	this.domNode.style.resize = "none";

	this.domNode.style["-webkit-text-fill-color"] = "currentcolor";
};

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

	this._on(this.domNode, "beforeinput", function(e){ self.handleBeforeInputEvent(e); });

	this._on(this.domNode, "compositionstart", function(e){ self.handleCompositionStart(e); });
	this._on(this.domNode, "compositionend", function(e){ self.handleCompositionEnd(e); });

	this._setInterval(function(){ self.checkSelectionChange(); }, 60);

	if(this.widget.isFileDropEnabled) {
		this._on(this.domNode, "dragenter", function(e){ self.widget.handleDragEnterEvent(e); });
		this._on(this.domNode, "dragover", function(e){ self.widget.handleDragOverEvent(e); });
		this._on(this.domNode, "dragleave", function(e){ self.widget.handleDragLeaveEvent(e); });
		this._on(this.domNode, "dragend", function(e){ self.widget.handleDragEndEvent(e); });
		this._on(this.domNode, "drop", function(e){ self.widget.handleDropEvent(e); });
		this._on(this.domNode, "paste", function(e){ self.widget.handlePasteEvent(e); });
	}
};

FramedEngine.prototype.initializePlugins = function() {
	var self = this;

	$tw.modules.forEachModuleOfType("editor-plugin", function(title, module) {
		if(!module || !module.create) return;
		try {
			var plugin = module.create(self);
			if(plugin) self.registerPlugin(plugin);
		} catch(e) {
			console.error("Failed to create editor plugin:", title, e);
		}
	});

	if(this.widget.editEnableSmartPairs === "yes") this.enablePlugin("smart-pairs");
	if(this.widget.editEnableMultiCursor === "yes") this.enablePlugin("multi-cursor");
	if(this.widget.editEnableVimMode === "yes") this.enablePlugin("vim-mode");
	if(this.widget.editEnableInlinePreview === "yes") this.enablePlugin("inline-preview");

	if(this.widget.editEnableSearch === "yes") this.enablePlugin("search");
	if(this.widget.editEnableCommandPalette === "yes") this.enablePlugin("command-palette");
	if(this.widget.editEnableFolding === "yes") this.enablePlugin("folding");
	if(this.widget.editShowWhitespace === "yes") this.enablePlugin("whitespace");
};

FramedEngine.prototype.registerPlugin = function(plugin) {
	this.plugins.push(plugin);

	if(plugin.hooks) {
		for(var hookName in plugin.hooks) {
			if(this.hooks[hookName]) {
				this.hooks[hookName].push({ plugin: plugin, handler: plugin.hooks[hookName] });
			}
		}
	}

	if(plugin.onRegister) {
		try { plugin.onRegister(this); }
		catch(e) { console.error("Plugin onRegister error:", plugin.name, e); }
	}
};

FramedEngine.prototype.getPlugin = function(name) {
	return this.plugins.find(function(p){ return p && p.name === name; });
};

FramedEngine.prototype.enablePlugin = function(name) {
	var plugin = this.getPlugin(name);
	if(plugin && plugin.enable) {
		try { plugin.enable(); }
		catch(e) { console.error("Plugin enable error:", name, e); }
	}
};

FramedEngine.prototype.disablePlugin = function(name) {
	var plugin = this.getPlugin(name);
	if(plugin && plugin.disable) {
		try { plugin.disable(); }
		catch(e) { console.error("Plugin disable error:", name, e); }
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

FramedEngine.prototype.getCursors = function() { return this.cursors; };
FramedEngine.prototype.getPrimaryCursor = function() { return this.cursors.find(function(c){ return c.isPrimary; }); };
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
	this.cursors = this.cursors.filter(function(c){ return c.isPrimary || c.id !== id; });
	this.renderCursors();
};

FramedEngine.prototype.clearSecondaryCursors = function() {
	this.cursors = this.cursors.filter(function(c){ return c.isPrimary; });
	this.renderCursors();
};

FramedEngine.prototype.sortAndMergeCursors = function() {
	this.cursors.sort(function(a,b){ return a.start - b.start; });
	if(this.cursors.length < 2) return;

	var merged = [this.cursors[0]];
	for(var i = 1; i < this.cursors.length; i++) {
		var cur = this.cursors[i];
		var last = merged[merged.length - 1];
		if(cur.start <= last.end + 1) {
			last.end = Math.max(last.end, cur.end);
			last.isPrimary = last.isPrimary || cur.isPrimary;
		} else {
			merged.push(cur);
		}
	}
	this.cursors = merged;

	var primaryIndex = -1;
	for(i = 0; i < this.cursors.length; i++) {
		if(this.cursors[i].isPrimary) { primaryIndex = i; break; }
	}
	if(primaryIndex === -1) primaryIndex = 0;
	for(i = 0; i < this.cursors.length; i++) {
		this.cursors[i].isPrimary = (i === primaryIndex);
	}
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

FramedEngine.prototype.renderCursors = function() {
	if(!this.cursorLayer || !this.iframeDoc) return;
	var self = this;
	this.cursorLayer.innerHTML = "";

	this.cursors.forEach(function(cursor) {
		if(cursor.isPrimary) return;

		if(cursor.start !== cursor.end) {
			var rects = self.getRectsForRange(cursor.start, cursor.end);
			for(var i = 0; i < rects.length; i++) {
				var r = rects[i];
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
	});

	this.runHooks("render", null, { layer: this.cursorLayer, decorationLayer: this.decorationLayer });
};

FramedEngine.prototype.getCoordinatesForPosition = function(position) {
	var textarea = this.domNode;
	if(!textarea || !this.iframeDoc || !this.iframeNode || !this.iframeNode.contentWindow) return null;

	var text = textarea.value || "";
	position = Math.max(0, Math.min(position, text.length));

	var win = this.iframeNode.contentWindow;
	var cs = win.getComputedStyle(textarea);

	var mirror = this.iframeDoc.createElement("div");
	mirror.style.position = "absolute";
	mirror.style.visibility = "hidden";
	mirror.style.whiteSpace = "pre-wrap";
	mirror.style.wordWrap = "break-word";
	mirror.style.overflowWrap = cs.overflowWrap || "break-word";
	mirror.style.wordBreak = cs.wordBreak || "normal";
	mirror.style.boxSizing = cs.boxSizing;
	mirror.style.width = textarea.clientWidth + "px";

	var props = [
		"fontFamily","fontSize","fontWeight","fontStyle","letterSpacing",
		"textTransform","wordSpacing","textIndent","lineHeight","tabSize",
		"paddingTop","paddingRight","paddingBottom","paddingLeft",
		"borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth"
	];
	for(var i = 0; i < props.length; i++) mirror.style[props[i]] = cs[props[i]];

	mirror.textContent = text.substring(0, position);

	var span = this.iframeDoc.createElement("span");
	span.textContent = text.substring(position, position + 1) || "\u200B";
	mirror.appendChild(span);

	this.iframeDoc.body.appendChild(mirror);

	var left = span.offsetLeft;
	var top = span.offsetTop;

	var lh = parseFloat(cs.lineHeight);
	var height = (isFinite(lh) && lh > 0) ? lh : (span.getBoundingClientRect().height || 20);

	this.iframeDoc.body.removeChild(mirror);

	return { left: left, top: top, height: height };
};

FramedEngine.prototype.getRectsForRange = function(start,end) {
	var s = this.getCoordinatesForPosition(start);
	var e = this.getCoordinatesForPosition(end);
	if(!s || !e) return [];

	var lineHeight = s.height;

	if(Math.abs(s.top - e.top) < lineHeight * 0.5) {
		return [{
			left: s.left,
			top: s.top,
			width: Math.max(e.left - s.left, 2),
			height: lineHeight
		}];
	}

	var rects = [];
	var win = this.iframeNode.contentWindow;
	var cs = win.getComputedStyle(this.domNode);
	var paddingLeft = parseFloat(cs.paddingLeft) || 0;
	var paddingRight = parseFloat(cs.paddingRight) || 0;
	var contentWidth = Math.max(0, this.domNode.clientWidth - paddingLeft - paddingRight);

	rects.push({
		left: s.left,
		top: s.top,
		width: Math.max((paddingLeft + contentWidth) - s.left, 2),
		height: lineHeight
	});

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

	rects.push({
		left: paddingLeft,
		top: e.top,
		width: Math.max(e.left - paddingLeft, 2),
		height: lineHeight
	});

	return rects;
};

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

FramedEngine.prototype.insertAtAllCursors = function(insertText) {
	if(insertText === undefined || insertText === null) return;
	insertText = String(insertText);

	this.captureBeforeState();

	var text = this.domNode.value;
	var sortedDesc = this.cursors.slice().sort(function(a,b){ return b.start - a.start; });

	for(var i = 0; i < sortedDesc.length; i++) {
		var c = sortedDesc[i];
		text = text.substring(0, c.start) + insertText + text.substring(c.end);
	}

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

	var sortedAsc = this.cursors.slice().sort(function(a,b){ return a.start - b.start; });
	var cumulative = 0;
	for(i = 0; i < sortedAsc.length; i++) {
		c = sortedAsc[i];
		var d = deletions.find(function(x){ return x.id === c.id; });
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

	var sorted = this.cursors.slice().sort(function(a,b){ return a.start - b.start; });
	for(var i = 0; i < sorted.length; i++) {
		var c = sorted[i];
		ops.push({
			text: text,
			selStart: c.start,
			selEnd: c.end,
			selection: text.substring(c.start, c.end),
			cutStart: null,
			cutEnd: null,
			replacement: null,
			newSelStart: null,
			newSelEnd: null,
			cursorId: c.id,
			cursorIndex: i
		});
	}

	if(ops.length === 1) {
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

	if(Array.isArray(operations) && operations.length === 1 && operations.replacement !== undefined) {
		operations[0].cutStart = operations.cutStart;
		operations[0].cutEnd = operations.cutEnd;
		operations[0].replacement = operations.replacement;
		operations[0].newSelStart = operations.newSelStart;
		operations[0].newSelEnd = operations.newSelEnd;
	}

	var active = opArray.filter(function(op){ return op && op.replacement !== null && op.replacement !== undefined; });
	if(!active.length) return this.domNode.value;

	var hookResult = this.runHooks("beforeOperation", null, opArray);
	if(hookResult.prevented) return this.domNode.value;

	opArray = hookResult.data;
	active = opArray.filter(function(op){ return op && op.replacement !== null && op.replacement !== undefined; });
	if(!active.length) return this.domNode.value;

	this.captureBeforeState();

	active.sort(function(a,b){ return (b.cutStart || 0) - (a.cutStart || 0); });

	var text = this.domNode.value;
	var updates = [];

	for(var i = 0; i < active.length; i++) {
		var op = active[i];

		var cutStart = Math.max(0, Math.min(op.cutStart, text.length));
		var cutEnd = Math.max(cutStart, Math.min(op.cutEnd, text.length));
		var repl = String(op.replacement);

		text = text.substring(0, cutStart) + repl + text.substring(cutEnd);

		var newSelStart = (op.newSelStart !== null && op.newSelStart !== undefined) ? op.newSelStart : (cutStart + repl.length);
		var newSelEnd = (op.newSelEnd !== null && op.newSelEnd !== undefined) ? op.newSelEnd : newSelStart;

		updates.push({
			cursorId: op.cursorId,
			cutStart: op.cutStart,
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
		var u = updates.find(function(x){ return x.cursorId === c.id; });
		if(!u) continue;

		var offset = 0;
		for(var j = 0; j < sorted.length; j++) {
			if(sorted[j].cutStart < u.cutStart) offset += sorted[j].delta;
			else break;
		}

		c.start = u.newStart + offset;
		c.end = u.newEnd + offset;
	}

	this.sortAndMergeCursors();
};

FramedEngine.prototype.applySingleCursorEdit = function(edit) {
	edit = edit || {};
	if(edit.cutStart === undefined || edit.cutEnd === undefined) return;

	var ops = this.createTextOperation();
	var primary = Array.isArray(ops) ? ops[0] : ops;

	var cutStart = edit.cutStart;
	var cutEnd = edit.cutEnd;
	var repl = (edit.replacement === undefined || edit.replacement === null) ? "" : String(edit.replacement);

	primary.cutStart = cutStart;
	primary.cutEnd = cutEnd;
	primary.replacement = repl;

	if(edit.newSelStart !== undefined) primary.newSelStart = edit.newSelStart;
	if(edit.newSelEnd !== undefined) primary.newSelEnd = edit.newSelEnd;

	return this.executeTextOperation([primary]);
};

FramedEngine.prototype.applyTextTransform = function(transformFn, opts) {
	opts = opts || {};
	if(typeof transformFn !== "function") return;

	this.captureBeforeState();

	var beforeText = this.domNode.value;
	var beforeCursors = JSON.parse(JSON.stringify(this.cursors));
	var out = transformFn(beforeText, beforeCursors);

	if(!out || typeof out.text !== "string" || !Array.isArray(out.cursors)) {
		return;
	}

	this.domNode.value = out.text;
	this.cursors = out.cursors;

	this.sortAndMergeCursors();
	this.syncDOMFromCursor();
	this.renderCursors();

	this.recordUndo(!!opts.forceSeparate);
	this.widget.saveChanges(out.text);
	this.fixHeight();
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

FramedEngine.prototype.getPositionFromMouseEvent = function(event) {
	if(!event || !this.domNode) return this.domNode.selectionStart || 0;

	if(typeof this.domNode.selectionStart === "number") {
		return this.domNode.selectionStart;
	}
	return 0;
};

FramedEngine.prototype.handleCompositionStart = function(event) {
	if(this._destroyed) return;

	if(this.hasMultipleCursors()) {
		this.clearSecondaryCursors();
	}

	this.captureBeforeState();
};

FramedEngine.prototype.handleCompositionEnd = function(event) {
	if(this._destroyed) return;
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

	if(this.hasMultipleCursors()) {
		var newText = this.domNode.value;
		var oldText = this.lastKnownText;

		if(newText !== oldText && oldText !== undefined) {
			var selStart = this.lastKnownSelection.start;
			var selEnd = this.lastKnownSelection.end;

			var expected = oldText.length - (selEnd - selStart);
			var insertedLen = newText.length - expected;

			if(insertedLen > 0) {
				var inserted = newText.substring(selStart, selStart + insertedLen);
				this.domNode.value = oldText;
				this.insertAtAllCursors(inserted);
				return true;
			}

			if(insertedLen < 0) {
				this.clearSecondaryCursors();
			}
		}
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
	if((event.ctrlKey || event.metaKey) && (event.key === "x" || event.key === "v")) return true;
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

	if((event.ctrlKey || event.metaKey) && !event.altKey) {
		var k = String(event.key).toLowerCase();
		if(!event.shiftKey && k === "z") { event.preventDefault(); this.undo(); return true; }
		if((!event.shiftKey && k === "y") || (event.shiftKey && k === "z")) { event.preventDefault(); this.redo(); return true; }
	}

	if(event.key === "Escape" && this.hasMultipleCursors()) {
		this.clearSecondaryCursors();
	}

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

	if(this.overlayNode && this.domNode) {
		this.overlayNode.style.transform =
			"translate(-" + this.domNode.scrollLeft + "px, -" + this.domNode.scrollTop + "px)";
	}

	this.renderCursors();
};

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
	this.hooks = {};
	this.cursors = [];
	this.undoStack = [];
	this.redoStack = [];
	this.pendingBeforeState = null;
};

FramedEngine.prototype.getDocument = function(){ return this.iframeDoc; };
FramedEngine.prototype.getWindow = function(){ return this.iframeNode && this.iframeNode.contentWindow; };
FramedEngine.prototype.getWrapperNode = function(){ return this.wrapperNode; };
FramedEngine.prototype.getOverlayLayer = function(){ return this.overlayNode; };
FramedEngine.prototype.getDecorationLayer = function(){ return this.decorationLayer; };
FramedEngine.prototype.getCursorLayer = function(){ return this.cursorLayer; };

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

FramedEngine.prototype.saveChanges = function() {
	this.widget.saveChanges(this.getText());
};

FramedEngine.prototype.dispatchEvent = function(eventInfo) {
	this.widget.dispatchEvent(eventInfo);
};

exports.FramedEngine = FramedEngine;
