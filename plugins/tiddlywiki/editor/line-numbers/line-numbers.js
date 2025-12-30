/*\
title: $:/plugins/tiddlywiki/editor/line-numbers/line-numbers.js
type: application/javascript
module-type: editor-plugin

Logical line numbers for the framed editor engine.
Uses direct position measurement for accuracy.

Plugin Metadata:
- name: line-numbers
- configTiddler: $:/config/Editor/ShowLineNumbers
- defaultEnabled: true

\*/

"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "line-numbers";
exports.configTiddler = "$:/config/Editor/ShowLineNumbers";
exports.configTiddlerAlt = "$:/config/ShowLineNumbers";
exports.defaultEnabled = true;
exports.description = "Show line numbers in the editor gutter";
exports.category = "display";

// ==================== PLUGIN IMPLEMENTATION ====================

exports.create = function(engine) {
	return new LineNumbersPlugin(engine);
};

function LineNumbersPlugin(engine) {
	this.engine = engine;
	this.name = "line-numbers";
	this.enabled = false;

	this.gutter = null;
	this.mainNode = null;
	this.mirror = null;
	this.styleEl = null;

	this._raf = 0;
	this._measuredLineHeight = 0;

	this._cache = {
		text: "",
		lines: [],
		lineStartPositions: [], // Character position where each line starts
		lineHeight: 16,
		paddingTop: 0
	};

	this._last = {
		scrollTop: -1,
		clientHeight: -1,
		caretPos: -1,
		textHash: null,
		width: -1
	};

	this.hooks = {
		afterInput: this.scheduleRefresh.bind(this),
		afterKeydown: this.scheduleRefresh.bind(this),
		selectionChange: this.scheduleRefresh.bind(this),
		render: this.scheduleRefresh.bind(this),
		focus: this.onFocus.bind(this),
		blur: this.onBlur.bind(this)
	};
}

LineNumbersPlugin.prototype.enable = function() {
	if(this.enabled) return;
	this.enabled = true;
	this.mount();
	var self = this;
	setTimeout(function() {
		self.refresh(true);
	}, 0);
};

LineNumbersPlugin.prototype.disable = function() {
	if(!this.enabled) return;
	this.enabled = false;
	this.unmount();
};

LineNumbersPlugin.prototype.destroy = function() {
	this.disable();
};

LineNumbersPlugin.prototype.mount = function() {
	var doc = this.engine.getDocument();
	if(!doc || !this.engine.domNode) return;

	var container = this.engine.container || doc.querySelector(".tc-editor-container");
	if(!container) return;

	// Get gutter
	this.gutter = this.engine.gutterNode || container.querySelector(".tc-editor-gutter");
	if(!this.gutter) {
		this.gutter = doc.createElement("div");
		this.gutter.className = "tc-editor-gutter";
		container.insertBefore(this.gutter, container.firstChild);
	}

	// Get main node
	this.mainNode = this.engine.mainNode || container.querySelector(".tc-editor-main");
	if(!this.mainNode) {
		this.mainNode = container;
	}

	// Show gutter
	this.gutter.classList.add("tc-gutter-active");
	this.gutter.style.display = "block";

	// Inject CSS
	this.injectStyles(doc);

	// Create mirror div inside mainNode for line height measurement
	this.mirror = doc.createElement("div");
	this.mirror.className = "tc-line-mirror";
	this.mirror.setAttribute("aria-hidden", "true");
	this.mainNode.appendChild(this.mirror);

	// Resize listener
	var win = this.engine.getWindow && this.engine.getWindow();
	if(win) {
		var self = this;
		this._onResize = function() { self.refresh(true); };
		win.addEventListener("resize", this._onResize);
	}
};

LineNumbersPlugin.prototype.injectStyles = function(doc) {
	if(this.styleEl) return;

	this.styleEl = doc.createElement("style");
	this.styleEl.textContent = [
		".tc-editor-gutter.tc-gutter-active {",
		"  display: block !important;",
		"  min-width: 3em;",
		"  padding: 0;",
		"  position: relative;",
		"  overflow: hidden;",
		"  user-select: none;",
		"  pointer-events: none;",
		"}",

		".tc-ln {",
		"  position: absolute;",
		"  left: 0;",
		"  right: 0.5em;",
		"  white-space: nowrap;",
		"  font-variant-numeric: tabular-nums;",
		"  text-align: right;",
		"  color: var(--tc-editor-gutter-fg, rgba(0,0,0,0.5));",
		"  font-size: inherit;",
		"  overflow: hidden;",
		"}",
		".tc-ln-active {",
		"  color: var(--tc-editor-gutter-fg-active, rgba(0,0,0,0.85));",
		"  font-weight: 600;",
		"}",
		".tc-gutter-focus .tc-ln-active {",
		"  color: var(--tc-editor-cursor, #3b82f6);",
		"}",

		".tc-line-mirror {",
		"  position: absolute;",
		"  top: 0;",
		"  left: 0;",
		"  visibility: hidden;",
		"  height: auto;",
		"  overflow: hidden;",
		"  pointer-events: none;",
		"  z-index: -1;",
		"  border: none;",
		"  margin: 0;",
		"  padding: 0;",
		"  white-space: pre-wrap;",
		"  word-wrap: break-word;",
		"  overflow-wrap: break-word;",
		"}"
	].join("\n");

	doc.head.appendChild(this.styleEl);
};

LineNumbersPlugin.prototype.unmount = function() {
	this.cancelRAF();

	var win = this.engine.getWindow && this.engine.getWindow();
	if(win && this._onResize) {
		try { win.removeEventListener("resize", this._onResize); } catch(e) {}
	}
	this._onResize = null;

	if(this.gutter) {
		this.gutter.innerHTML = "";
		this.gutter.classList.remove("tc-gutter-active", "tc-gutter-focus");
		this.gutter.style.display = "";
	}
	this.gutter = null;

	if(this.mirror && this.mirror.parentNode) {
		this.mirror.parentNode.removeChild(this.mirror);
	}
	this.mirror = null;
	this.mainNode = null;

	if(this.styleEl && this.styleEl.parentNode) {
		this.styleEl.parentNode.removeChild(this.styleEl);
	}
	this.styleEl = null;

	this._measuredLineHeight = 0;
};

LineNumbersPlugin.prototype.onFocus = function() {
	if(this.gutter) this.gutter.classList.add("tc-gutter-focus");
	this.scheduleRefresh();
};

LineNumbersPlugin.prototype.onBlur = function() {
	if(this.gutter) this.gutter.classList.remove("tc-gutter-focus");
	this.scheduleRefresh();
};

LineNumbersPlugin.prototype.scheduleRefresh = function() {
	if(!this.enabled) return;
	var self = this;
	if(this._raf) return;
	this._raf = (this.engine.getWindow() || window).requestAnimationFrame(function() {
		self._raf = 0;
		self.refresh(false);
	});
};

LineNumbersPlugin.prototype.cancelRAF = function() {
	if(this._raf) {
		try { 
			(this.engine.getWindow() || window).cancelAnimationFrame(this._raf); 
		} catch(e) {}
		this._raf = 0;
	}
};

/**
 * Sync mirror styles for line height measurement
 */
LineNumbersPlugin.prototype.syncMirrorStyles = function() {
	var ta = this.engine.domNode;
	var win = this.engine.getWindow && this.engine.getWindow();
	if(!ta || !win || !this.mirror) return false;

	var cs = win.getComputedStyle(ta);

	var props = [
		"fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch",
		"fontVariant", "letterSpacing", "textTransform", "wordSpacing",
		"textIndent", "lineHeight", "tabSize", "fontKerning", "textRendering",
		"direction", "unicodeBidi"
	];

	for(var i = 0; i < props.length; i++) {
		try {
			var val = cs[props[i]];
			if(val) this.mirror.style[props[i]] = val;
		} catch(e) {}
	}

	this.mirror.style.whiteSpace = "pre-wrap";
	this.mirror.style.wordWrap = "break-word";
	this.mirror.style.overflowWrap = "break-word";
	this.mirror.style.wordBreak = cs.wordBreak || "normal";

	var paddingLeft = parseFloat(cs.paddingLeft) || 0;
	var paddingRight = parseFloat(cs.paddingRight) || 0;
	var contentWidth = ta.clientWidth - paddingLeft - paddingRight;

	if(contentWidth <= 0) return false;

	this.mirror.style.width = contentWidth + "px";
	this.mirror.style.boxSizing = "content-box";
	this.mirror.style.padding = "0";

	this._measuredLineHeight = this.measureActualLineHeight();

	return this._measuredLineHeight > 0;
};

/**
 * Measure actual line height
 */
LineNumbersPlugin.prototype.measureActualLineHeight = function() {
	if(!this.mirror) return 16;

	this.mirror.textContent = "X";
	var h1 = this.mirror.offsetHeight;

	this.mirror.textContent = "X\nX";
	var h2 = this.mirror.offsetHeight;

	var lineHeight = h2 - h1;

	if(lineHeight <= 0 || lineHeight > 100) {
		lineHeight = h1 > 0 ? h1 : 16;
	}

	return lineHeight;
};

/**
 * Get Y coordinate for a character position using the engine's method
 */
LineNumbersPlugin.prototype.getYForPosition = function(position) {
	// Use engine's coordinate calculation if available
	if(this.engine.getCoordinatesForPosition) {
		var coords = this.engine.getCoordinatesForPosition(position);
		if(coords) {
			return coords.top;
		}
	}
	
	// Fallback: use mirror measurement
	return this.getYForPositionViaMirror(position);
};

/**
 * Fallback: measure Y position using mirror
 */
LineNumbersPlugin.prototype.getYForPositionViaMirror = function(position) {
	var ta = this.engine.domNode;
	var win = this.engine.getWindow && this.engine.getWindow();
	if(!ta || !win || !this.mirror) return 0;

	var text = ta.value || "";
	var textBefore = text.substring(0, position);

	// Put text before position in mirror and measure height
	this.mirror.textContent = textBefore || "\u200B";
	
	// The Y position is the height of all text before this position
	// minus one line (since we want the top of the current line)
	var height = this.mirror.offsetHeight;
	
	// If position is at start of a line, we want the top of that line
	// which is height - lineHeight (approximately)
	// But if it's the very first character, it's 0
	if(position === 0) {
		return 0;
	}
	
	// Check if we're at the start of a line
	if(position > 0 && text[position - 1] === "\n") {
		return height;
	}
	
	// Otherwise, find the last newline and measure from there
	var lastNewline = textBefore.lastIndexOf("\n");
	if(lastNewline === -1) {
		// First line
		return 0;
	}
	
	// Measure up to and including the last newline
	this.mirror.textContent = textBefore.substring(0, lastNewline + 1) || "\u200B";
	return this.mirror.offsetHeight;
};

LineNumbersPlugin.prototype.fastHash = function(s) {
	if(!s) return "L0:";
	if(s.length <= 64) return "L" + s.length + ":" + s;
	return "L" + s.length + ":" + s.slice(0, 24) + "|" + s.slice(-24);
};

/**
 * Rebuild line cache - just track line start positions
 */
LineNumbersPlugin.prototype.rebuildLineCache = function() {
	var ta = this.engine.domNode;
	if(!ta) return;

	if(!this.syncMirrorStyles()) {
		return;
	}

	var cs = this.engine.getWindow().getComputedStyle(ta);
	var paddingTop = parseFloat(cs.paddingTop) || 0;

	var text = ta.value || "";
	var lines = text.split("\n");
	if(lines.length === 0) lines = [""];

	// Calculate character position where each line starts
	var lineStartPositions = new Array(lines.length);
	var pos = 0;
	for(var i = 0; i < lines.length; i++) {
		lineStartPositions[i] = pos;
		pos += lines[i].length + 1; // +1 for the newline
	}

	this._cache.text = text;
	this._cache.lines = lines;
	this._cache.lineStartPositions = lineStartPositions;
	this._cache.lineHeight = this._measuredLineHeight;
	this._cache.paddingTop = paddingTop;

	this._last.width = ta.clientWidth;
	this._last.textHash = this.fastHash(text);
};

/**
 * Check if cache needs rebuild
 */
LineNumbersPlugin.prototype.needsCacheRebuild = function() {
	var ta = this.engine.domNode;
	if(!ta) return false;

	var text = ta.value || "";
	var hash = this.fastHash(text);

	return (
		this._last.width !== ta.clientWidth ||
		this._last.textHash !== hash
	);
};

/**
 * Find logical line at caret
 */
LineNumbersPlugin.prototype.logicalLineAtCaret = function() {
	var ta = this.engine.domNode;
	if(!ta) return 0;

	var pos = typeof ta.selectionStart === "number" ? ta.selectionStart : 0;
	var text = ta.value || "";
	pos = Math.max(0, Math.min(pos, text.length));

	var before = text.substring(0, pos);
	return before.split("\n").length - 1;
};

/**
 * Binary search to find approximate line at scroll position
 */
LineNumbersPlugin.prototype.findLineAtScrollTop = function(scrollTop) {
	var lines = this._cache.lines;
	var positions = this._cache.lineStartPositions;
	var paddingTop = this._cache.paddingTop;
	
	if(!lines || lines.length === 0) return 0;
	
	// For very large files, use binary search with sampling
	var targetY = scrollTop - paddingTop;
	if(targetY <= 0) return 0;
	
	var lo = 0;
	var hi = lines.length - 1;
	
	// Sample a few lines to narrow down
	while(hi - lo > 10) {
		var mid = Math.floor((lo + hi) / 2);
		var midY = this.getYForPosition(positions[mid]);
		
		if(midY < targetY) {
			lo = mid;
		} else {
			hi = mid;
		}
	}
	
	// Linear search in the narrowed range
	for(var i = lo; i <= hi; i++) {
		var y = this.getYForPosition(positions[i]);
		if(y >= targetY) {
			return Math.max(0, i - 1);
		}
	}
	
	return hi;
};

/**
 * Main refresh - render logical line numbers at exact positions
 */
LineNumbersPlugin.prototype.refresh = function(force) {
	if(!this.enabled || !this.gutter || !this.engine.domNode) return;

	var ta = this.engine.domNode;

	// Sync gutter height
	this.gutter.style.height = ta.clientHeight + "px";

	// Rebuild cache if needed
	if(force || this.needsCacheRebuild()) {
		this.rebuildLineCache();
	}

	var lineHeight = this._cache.lineHeight;
	var paddingTop = this._cache.paddingTop;
	var lines = this._cache.lines;
	var positions = this._cache.lineStartPositions;

	if(lineHeight <= 0 || !lines || lines.length === 0) {
		return;
	}

	var scrollTop = ta.scrollTop;
	var clientHeight = ta.clientHeight;

	// Find visible line range using binary search
	var firstVisible = this.findLineAtScrollTop(scrollTop);
	
	// Estimate last visible (will render a few extra for safety)
	var estimatedVisibleLines = Math.ceil(clientHeight / lineHeight) + 5;
	var lastVisible = Math.min(lines.length - 1, firstVisible + estimatedVisibleLines);

	// Overscan
	var overscan = 5;
	var renderStart = Math.max(0, firstVisible - overscan);
	var renderEnd = Math.min(lines.length - 1, lastVisible + overscan);

	// Active logical line
	var activeLogical = this.logicalLineAtCaret();

	// Check if render needed
	var needsRender =
		force ||
		this._last.scrollTop !== scrollTop ||
		this._last.clientHeight !== clientHeight ||
		this._last.caretPos !== ta.selectionStart;

	this._last.scrollTop = scrollTop;
	this._last.clientHeight = clientHeight;
	this._last.caretPos = ta.selectionStart;

	if(!needsRender) return;

	// Render logical line numbers at exact Y positions
	var doc = this.engine.getDocument();
	var frag = doc.createDocumentFragment();

	for(var i = renderStart; i <= renderEnd; i++) {
		// Get exact Y position for this line's start
		var y = this.getYForPosition(positions[i]);
		
		var el = doc.createElement("div");
		el.className = "tc-ln" + (i === activeLogical ? " tc-ln-active" : "");
		el.textContent = String(i + 1);
		el.style.position = "absolute";
		el.style.height = lineHeight + "px";
		el.style.lineHeight = lineHeight + "px";
		el.style.top = (paddingTop + y - scrollTop) + "px";
		frag.appendChild(el);
	}

	this.gutter.innerHTML = "";
	this.gutter.appendChild(frag);
};