/*\
title: $:/plugins/tiddlywiki/editor/folding/folding.js
type: application/javascript
module-type: editor-plugin

Enhanced code/content folding with:
- Heading-based section detection (!, !!, !!!, etc.)
- Code block folding (``` blocks)
- Clickable fold markers in gutter (▶/▼)
- Fold all / Unfold all commands
- Fold level controls (fold all level 2+, etc.)
- Visual overlay with customizable marker
- Keyboard shortcuts (Ctrl+Shift+[ and Ctrl+Shift+])

Shortcuts:
- Ctrl+Shift+[: Fold current section
- Ctrl+Shift+]: Unfold current section
- Ctrl+Shift+Alt+[: Fold all
- Ctrl+Shift+Alt+]: Unfold all

\*/

"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "folding";
exports.configTiddler = "$:/config/Editor/EnableFolding";
exports.configTiddlerAlt = "$:/config/EnableFolding";
exports.defaultEnabled = true;
exports.description = "Fold/unfold sections in the editor";
exports.category = "display";
exports.supports = { simple: false, framed: true };

exports.create = function(engine) { return new FoldingPlugin(engine); };

// ==================== CONSTANTS ====================
var FOLD_MARKER_CLASS = "tc-fold-marker";
var FOLD_COVER_CLASS = "tc-fold-cover";
var FOLD_ELLIPSIS_CLASS = "tc-fold-ellipsis";

// ==================== PLUGIN IMPLEMENTATION ====================

function FoldingPlugin(engine) {
	this.engine = engine;
	this.name = "folding";
	this.enabled = false;

	// Fold state: Map of sectionStartPos -> boolean (true = folded)
	this.folds = {};

	// Parsed sections
	this.sections = [];

	// UI elements
	this.overlayEls = [];
	this.gutterMarkers = [];
	this.styleEl = null;

	// Options
	this.options = {
		enabledByDefault: false,
		minFoldLines: 2,
		foldMarker: "…",
		foldHeadings: true,
		foldCodeBlocks: true
	};

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this),
		afterInput: this.onAfterInput.bind(this),
		render: this.onRender.bind(this),
		focus: this.onFocus.bind(this)
	};
}

// ==================== LIFECYCLE ====================

FoldingPlugin.prototype.enable = function() {
	this.enabled = true;
	this.injectStyles();
	this.recompute();
};

FoldingPlugin.prototype.disable = function() {
	this.enabled = false;
	this.clearOverlay();
	this.clearGutterMarkers();
	this.folds = {};
	this.sections = [];
	this.removeStyles();
};

FoldingPlugin.prototype.destroy = function() {
	this.disable();
};

FoldingPlugin.prototype.configure = function(options) {
	if(!options) return;

	if(options.enabledByDefault !== undefined) {
		this.options.enabledByDefault = !!options.enabledByDefault;
	}
	if(options.minFoldLines !== undefined) {
		this.options.minFoldLines = Math.max(1, parseInt(options.minFoldLines, 10) || 2);
	}
	if(options.foldMarker !== undefined) {
		this.options.foldMarker = String(options.foldMarker || "…");
	}
	if(options.foldHeadings !== undefined) {
		this.options.foldHeadings = !!options.foldHeadings;
	}
	if(options.foldCodeBlocks !== undefined) {
		this.options.foldCodeBlocks = !!options.foldCodeBlocks;
	}
};

// ==================== STYLES ====================

FoldingPlugin.prototype.injectStyles = function() {
	if(this.styleEl) return;

	var doc = this.engine.getDocument();
	if(!doc) return;

	this.styleEl = doc.createElement("style");
	this.styleEl.textContent = [
		// Gutter fold markers
		"." + FOLD_MARKER_CLASS + " {",
		"  position: absolute;",
		"  left: 2px;",
		"  width: 16px;",
		"  height: 16px;",
		"  display: flex;",
		"  align-items: center;",
		"  justify-content: center;",
		"  cursor: pointer;",
		"  user-select: none;",
		"  font-size: 10px;",
		"  color: var(--tc-fold-marker-fg, #888);",
		"  border-radius: 3px;",
		"  transition: background 0.1s, color 0.1s;",
		"  pointer-events: auto;",
		"}",
		"." + FOLD_MARKER_CLASS + ":hover {",
		"  background: var(--tc-fold-marker-hover-bg, rgba(0,0,0,0.1));",
		"  color: var(--tc-fold-marker-hover-fg, #333);",
		"}",
		"." + FOLD_MARKER_CLASS + ".is-folded {",
		"  color: var(--tc-fold-marker-folded, #0066cc);",
		"}",

		// Fold cover (hides content)
		"." + FOLD_COVER_CLASS + " {",
		"  position: absolute;",
		"  background: var(--tc-fold-cover-bg, rgba(248,249,250,0.95));",
		"  pointer-events: auto;",
		"  cursor: pointer;",
		"  z-index: 10;",
		"}",

		// Fold ellipsis indicator
		"." + FOLD_ELLIPSIS_CLASS + " {",
		"  position: absolute;",
		"  padding: 2px 8px;",
		"  background: var(--tc-fold-ellipsis-bg, #e9ecef);",
		"  color: var(--tc-fold-ellipsis-fg, #666);",
		"  font-size: 12px;",
		"  font-family: inherit;",
		"  border-radius: 4px;",
		"  cursor: pointer;",
		"  pointer-events: auto;",
		"  white-space: nowrap;",
		"  box-shadow: 0 1px 3px rgba(0,0,0,0.1);",
		"  z-index: 11;",
		"  transition: background 0.1s;",
		"}",
		"." + FOLD_ELLIPSIS_CLASS + ":hover {",
		"  background: var(--tc-fold-ellipsis-hover-bg, #dee2e6);",
		"}"
	].join("\n");

	(doc.head || doc.documentElement).appendChild(this.styleEl);
};

FoldingPlugin.prototype.removeStyles = function() {
	if(this.styleEl && this.styleEl.parentNode) {
		this.styleEl.parentNode.removeChild(this.styleEl);
	}
	this.styleEl = null;
};

// ==================== EVENT HOOKS ====================

FoldingPlugin.prototype.onKeydown = function(event) {
	if(!this.enabled) return;

	var ctrl = event.ctrlKey || event.metaKey;

	// Ctrl+Shift+[: Fold current section
	if(ctrl && event.shiftKey && !event.altKey && event.key === "[") {
		event.preventDefault();
		this.foldCurrentSection(true);
		return false;
	}

	// Ctrl+Shift+]: Unfold current section
	if(ctrl && event.shiftKey && !event.altKey && event.key === "]") {
		event.preventDefault();
		this.foldCurrentSection(false);
		return false;
	}

	// Ctrl+Shift+Alt+[: Fold all
	if(ctrl && event.shiftKey && event.altKey && event.key === "[") {
		event.preventDefault();
		this.foldAll();
		return false;
	}

	// Ctrl+Shift+Alt+]: Unfold all
	if(ctrl && event.shiftKey && event.altKey && event.key === "]") {
		event.preventDefault();
		this.unfoldAll();
		return false;
	}
};

FoldingPlugin.prototype.onAfterInput = function() {
	if(!this.enabled) return;
	this.recompute();
};

FoldingPlugin.prototype.onRender = function() {
	if(!this.enabled) return;
	this.renderOverlay();
	this.renderGutterMarkers();
};

FoldingPlugin.prototype.onFocus = function() {
	if(!this.enabled) return;
	this.recompute();
};

// ==================== SECTION DETECTION ====================

FoldingPlugin.prototype.recompute = function() {
	var text = this.engine.domNode.value || "";
	this.sections = this.getSections(text);
	this.renderOverlay();
	this.renderGutterMarkers();
};

FoldingPlugin.prototype.getSections = function(text) {
	var sections = [];
	var lines = text.split("\n");

	// Track heading sections
	if(this.options.foldHeadings) {
		var headingStarts = [];
		var pos = 0;

		for(var i = 0; i < lines.length; i++) {
			var line = lines[i];
			var headingMatch = line.match(/^(!{1,6})\s/);

			if(headingMatch) {
				headingStarts.push({
					line: i,
					pos: pos,
					level: headingMatch[1].length,
					type: "heading"
				});
			}

			pos += line.length + 1;
		}

		// Calculate section boundaries
		for(i = 0; i < headingStarts.length; i++) {
			var start = headingStarts[i];
			var end = text.length;

			// Find next heading of same or higher level
			for(var j = i + 1; j < headingStarts.length; j++) {
				if(headingStarts[j].level <= start.level) {
					end = headingStarts[j].pos;
					break;
				}
			}

			// Calculate line count
			var sectionText = text.slice(start.pos, end);
			var lineCount = (sectionText.match(/\n/g) || []).length;

			if(lineCount >= this.options.minFoldLines) {
				sections.push({
					start: start.pos,
					end: end,
					line: start.line,
					level: start.level,
					type: "heading",
					lineCount: lineCount
				});
			}
		}
	}

	// Track code block sections
	if(this.options.foldCodeBlocks) {
		var codeBlockPattern = /^```/;
		var inCodeBlock = false;
		var codeBlockStart = null;
		var codeBlockStartLine = -1;
		pos = 0;

		for(i = 0; i < lines.length; i++) {
			if(codeBlockPattern.test(lines[i])) {
				if(!inCodeBlock) {
					inCodeBlock = true;
					codeBlockStart = pos;
					codeBlockStartLine = i;
				} else {
					inCodeBlock = false;
					var codeEnd = pos + lines[i].length + 1;
					var codeLineCount = i - codeBlockStartLine;

					if(codeLineCount >= this.options.minFoldLines) {
						sections.push({
							start: codeBlockStart,
							end: codeEnd,
							line: codeBlockStartLine,
							level: 0,
							type: "codeblock",
							lineCount: codeLineCount
						});
					}
				}
			}

			pos += lines[i].length + 1;
		}
	}

	// Sort by start position
	sections.sort(function(a, b) { return a.start - b.start; });

	return sections;
};

// ==================== FOLD OPERATIONS ====================

FoldingPlugin.prototype.foldCurrentSection = function(fold) {
	var ta = this.engine.domNode;
	var pos = ta.selectionStart;

	var section = this.findSectionAtPosition(pos);
	if(!section) return;

	this.folds[section.start] = fold;
	this.renderOverlay();
	this.renderGutterMarkers();
};

FoldingPlugin.prototype.toggleFold = function(sectionStart) {
	this.folds[sectionStart] = !this.folds[sectionStart];
	this.renderOverlay();
	this.renderGutterMarkers();
};

FoldingPlugin.prototype.foldAll = function() {
	for(var i = 0; i < this.sections.length; i++) {
		this.folds[this.sections[i].start] = true;
	}
	this.renderOverlay();
	this.renderGutterMarkers();
};

FoldingPlugin.prototype.unfoldAll = function() {
	this.folds = {};
	this.renderOverlay();
	this.renderGutterMarkers();
};

FoldingPlugin.prototype.foldLevel = function(maxLevel) {
	// Fold all sections with level > maxLevel
	this.folds = {};
	for(var i = 0; i < this.sections.length; i++) {
		var sec = this.sections[i];
		if(sec.type === "heading" && sec.level > maxLevel) {
			this.folds[sec.start] = true;
		}
	}
	this.renderOverlay();
	this.renderGutterMarkers();
};

FoldingPlugin.prototype.findSectionAtPosition = function(pos) {
	// Find innermost section containing position
	var best = null;

	for(var i = 0; i < this.sections.length; i++) {
		var sec = this.sections[i];
		if(pos >= sec.start && pos < sec.end) {
			if(!best || (sec.end - sec.start) < (best.end - best.start)) {
				best = sec;
			}
		}
	}

	return best;
};

FoldingPlugin.prototype.getSectionAtLine = function(lineNum) {
	for(var i = 0; i < this.sections.length; i++) {
		if(this.sections[i].line === lineNum) {
			return this.sections[i];
		}
	}
	return null;
};

// ==================== OVERLAY RENDERING ====================

FoldingPlugin.prototype.clearOverlay = function() {
	for(var i = 0; i < this.overlayEls.length; i++) {
		var el = this.overlayEls[i];
		if(el && el.parentNode) {
			el.parentNode.removeChild(el);
		}
	}
	this.overlayEls = [];
};

FoldingPlugin.prototype.renderOverlay = function() {
	this.clearOverlay();

	var layer = this.engine.getOverlayLayer && this.engine.getOverlayLayer();
	if(!layer) return;

	var doc = this.engine.getDocument();
	var ta = this.engine.domNode;
	var text = ta.value;

	for(var i = 0; i < this.sections.length; i++) {
		var sec = this.sections[i];
		if(!this.folds[sec.start]) continue;

		// Find where to start folding (after the heading line)
		var headingEnd = text.indexOf("\n", sec.start);
		if(headingEnd === -1) continue;

		var foldStart = headingEnd + 1;
		if(foldStart >= sec.end) continue;

		// Get coordinates
		var startCoords = this.engine.getCoordinatesForPosition(foldStart);
		var endCoords = this.engine.getCoordinatesForPosition(sec.end);
		if(!startCoords || !endCoords) continue;

		// Create cover
		var cover = doc.createElement("div");
		cover.className = FOLD_COVER_CLASS;
		cover.style.left = "0";
		cover.style.top = startCoords.top + "px";
		cover.style.right = "0";
		cover.style.height = Math.max(16, (endCoords.top - startCoords.top) + endCoords.height) + "px";

		// Create ellipsis indicator
		var ellipsis = doc.createElement("div");
		ellipsis.className = FOLD_ELLIPSIS_CLASS;
		ellipsis.style.left = "20px";
		ellipsis.style.top = startCoords.top + "px";

		var lineCount = sec.lineCount - 1; // Exclude heading line
		var typeLabel = sec.type === "codeblock" ? "code" : "lines";
		ellipsis.textContent = this.options.foldMarker + " " + lineCount + " " + typeLabel + " folded";

		// Click to unfold
		var self = this;
		var sectionStart = sec.start;

		cover.addEventListener("click", function(e) {
			e.preventDefault();
			e.stopPropagation();
			self.folds[sectionStart] = false;
			self.renderOverlay();
			self.renderGutterMarkers();
		});

		ellipsis.addEventListener("click", function(e) {
			e.preventDefault();
			e.stopPropagation();
			self.folds[sectionStart] = false;
			self.renderOverlay();
			self.renderGutterMarkers();
		});

		layer.appendChild(cover);
		layer.appendChild(ellipsis);
		this.overlayEls.push(cover, ellipsis);
	}
};

// ==================== GUTTER MARKERS ====================

FoldingPlugin.prototype.clearGutterMarkers = function() {
	for(var i = 0; i < this.gutterMarkers.length; i++) {
		var el = this.gutterMarkers[i];
		if(el && el.parentNode) {
			el.parentNode.removeChild(el);
		}
	}
	this.gutterMarkers = [];
};

FoldingPlugin.prototype.renderGutterMarkers = function() {
	this.clearGutterMarkers();

	var gutter = this.engine.gutterNode;
	if(!gutter) return;

	var doc = this.engine.getDocument();
	var ta = this.engine.domNode;
	var text = ta.value;

	// Get line height from first line coordinates
	var lineHeight = 20;
	var firstCoords = this.engine.getCoordinatesForPosition(0);
	if(firstCoords && firstCoords.height) {
		lineHeight = firstCoords.height;
	}

	// Get computed padding
	var win = this.engine.getWindow();
	var cs = win ? win.getComputedStyle(ta) : null;
	var paddingTop = cs ? (parseFloat(cs.paddingTop) || 0) : 0;

	for(var i = 0; i < this.sections.length; i++) {
		var sec = this.sections[i];

		// Calculate Y position for this section's line
		var coords = this.engine.getCoordinatesForPosition(sec.start);
		if(!coords) continue;

		var isFolded = !!this.folds[sec.start];

		var marker = doc.createElement("div");
		marker.className = FOLD_MARKER_CLASS + (isFolded ? " is-folded" : "");
		marker.textContent = isFolded ? "▶" : "▼";
		marker.title = isFolded ? "Click to unfold" : "Click to fold";
		marker.style.top = (paddingTop + coords.top - ta.scrollTop) + "px";

		var self = this;
		var sectionStart = sec.start;

		marker.addEventListener("click", function(e) {
			e.preventDefault();
			e.stopPropagation();
			self.toggleFold(sectionStart);
		});

		gutter.appendChild(marker);
		this.gutterMarkers.push(marker);
	}
};

// ==================== COMMANDS FOR COMMAND PALETTE ====================

FoldingPlugin.prototype.getCommands = function() {
	var self = this;

	return [
		{
			id: "folding-fold-current",
			name: "Fold Current Section",
			category: "Folding",
			shortcut: "Ctrl+Shift+[",
			description: "Collapse the current heading or code block",
			action: function(engine) {
				self.foldCurrentSection(true);
			}
		},
		{
			id: "folding-unfold-current",
			name: "Unfold Current Section",
			category: "Folding",
			shortcut: "Ctrl+Shift+]",
			description: "Expand the current heading or code block",
			action: function(engine) {
				self.foldCurrentSection(false);
			}
		},
		{
			id: "folding-fold-all",
			name: "Fold All Sections",
			category: "Folding",
			shortcut: "Ctrl+Shift+Alt+[",
			description: "Collapse all foldable sections",
			action: function(engine) {
				self.foldAll();
			}
		},
		{
			id: "folding-unfold-all",
			name: "Unfold All Sections",
			category: "Folding",
			shortcut: "Ctrl+Shift+Alt+]",
			description: "Expand all folded sections",
			action: function(engine) {
				self.unfoldAll();
			}
		},
		{
			id: "folding-fold-level-1",
			name: "Fold to Level 1",
			category: "Folding",
			shortcut: "",
			description: "Fold all headings below level 1",
			action: function(engine) {
				self.foldLevel(1);
			}
		},
		{
			id: "folding-fold-level-2",
			name: "Fold to Level 2",
			category: "Folding",
			shortcut: "",
			description: "Fold all headings below level 2",
			action: function(engine) {
				self.foldLevel(2);
			}
		}
	];
};