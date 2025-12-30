/*\
title: $:/plugins/tiddlywiki/editor/diagnostics/diagnostics.js
type: application/javascript
module-type: editor-plugin

Real-time diagnostics for wikitext with:
- Inline error markers (squiggly underlines)
- Error positions (not just "unbalanced", but "unclosed at line 5")
- Error list panel (clickable to jump to error)
- Multiple diagnostic types:
  - Unbalanced wikitext tokens
  - Unclosed brackets/braces
  - Potentially broken links
  - Duplicate headings (optional)
- Configurable checks
- Severity levels (error, warning, info)

\*/

"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "diagnostics";
exports.configTiddler = "$:/config/Editor/EnableDiagnostics";
exports.defaultEnabled = false;
exports.description = "Real-time diagnostics for wikitext syntax";
exports.category = "editing";
exports.supports = { simple: false, framed: true };

exports.create = function(engine) { return new DiagnosticsPlugin(engine); };

// ==================== CONSTANTS ====================
var DIAGNOSTIC_CLASS = "tc-diagnostic";
var MARKER_CLASS = "tc-diagnostic-marker";
var BADGE_CLASS = "tc-diagnostic-badge";
var PANEL_CLASS = "tc-diagnostic-panel";

var SEVERITY = {
	ERROR: "error",
	WARNING: "warning",
	INFO: "info"
};

// ==================== PLUGIN IMPLEMENTATION ====================

function DiagnosticsPlugin(engine) {
	this.engine = engine;
	this.name = "diagnostics";
	this.enabled = false;

	// Diagnostics list: { severity, message, start, end, line, column }
	this.diagnostics = [];

	// UI elements
	this.styleEl = null;
	this.badge = null;
	this.panel = null;
	this.markers = [];

	// Options
	this.options = {
		checkBalanced: true,
		checkBrackets: true,
		checkLinks: false,
		checkDuplicateHeadings: false,
		showInlineMarkers: true,
		showBadge: true,
		showPanel: false,
		debounceMs: 300
	};

	// Debounce
	this.timer = null;
	this.lastText = null;

	this.hooks = {
		afterInput: this.onAfterInput.bind(this),
		render: this.onRender.bind(this),
		blur: this.onBlur.bind(this),
		focus: this.onFocus.bind(this)
	};
}

// ==================== LIFECYCLE ====================

DiagnosticsPlugin.prototype.enable = function() {
	this.enabled = true;
	this.injectStyles();
	this.schedule();
};

DiagnosticsPlugin.prototype.disable = function() {
	this.enabled = false;
	this.clear();
	this.removeStyles();

	if(this.timer) {
		clearTimeout(this.timer);
		this.timer = null;
	}
};

DiagnosticsPlugin.prototype.destroy = function() {
	this.disable();
};

DiagnosticsPlugin.prototype.configure = function(options) {
	if(!options) return;

	for(var key in options) {
		if(this.options.hasOwnProperty(key)) {
			this.options[key] = options[key];
		}
	}
};

// ==================== STYLES ====================

DiagnosticsPlugin.prototype.injectStyles = function() {
	if(this.styleEl) return;

	var doc = this.engine.getDocument();
	if(!doc) return;

	this.styleEl = doc.createElement("style");
	this.styleEl.textContent = [
		// Inline markers (squiggly underlines)
		"." + MARKER_CLASS + " {",
		"  position: absolute;",
		"  pointer-events: none;",
		"  z-index: 5;",
		"  border-bottom: 2px wavy;",
		"}",
		"." + MARKER_CLASS + ".severity-error {",
		"  border-bottom-color: var(--tc-diag-error, #dc3545);",
		"}",
		"." + MARKER_CLASS + ".severity-warning {",
		"  border-bottom-color: var(--tc-diag-warning, #ffc107);",
		"}",
		"." + MARKER_CLASS + ".severity-info {",
		"  border-bottom-color: var(--tc-diag-info, #17a2b8);",
		"}",

		// Badge
		"." + BADGE_CLASS + " {",
		"  position: absolute;",
		"  top: 4px;",
		"  right: 4px;",
		"  padding: 4px 8px;",
		"  font-size: 11px;",
		"  font-family: inherit;",
		"  border-radius: 4px;",
		"  cursor: pointer;",
		"  z-index: 20;",
		"  user-select: none;",
		"  display: flex;",
		"  align-items: center;",
		"  gap: 6px;",
		"}",
		"." + BADGE_CLASS + ".has-errors {",
		"  background: var(--tc-diag-error-bg, #f8d7da);",
		"  color: var(--tc-diag-error, #721c24);",
		"  border: 1px solid var(--tc-diag-error-border, #f5c6cb);",
		"}",
		"." + BADGE_CLASS + ".has-warnings {",
		"  background: var(--tc-diag-warning-bg, #fff3cd);",
		"  color: var(--tc-diag-warning, #856404);",
		"  border: 1px solid var(--tc-diag-warning-border, #ffeeba);",
		"}",
		"." + BADGE_CLASS + ".all-ok {",
		"  background: var(--tc-diag-ok-bg, #d4edda);",
		"  color: var(--tc-diag-ok, #155724);",
		"  border: 1px solid var(--tc-diag-ok-border, #c3e6cb);",
		"}",

		// Panel
		"." + PANEL_CLASS + " {",
		"  position: absolute;",
		"  top: 30px;",
		"  right: 4px;",
		"  width: 300px;",
		"  max-height: 200px;",
		"  background: var(--tc-diag-panel-bg, #fff);",
		"  border: 1px solid var(--tc-diag-panel-border, #ddd);",
		"  border-radius: 6px;",
		"  box-shadow: 0 4px 12px rgba(0,0,0,0.15);",
		"  overflow-y: auto;",
		"  z-index: 21;",
		"  font-size: 12px;",
		"}",
		"." + PANEL_CLASS + "-item {",
		"  padding: 8px 10px;",
		"  cursor: pointer;",
		"  border-bottom: 1px solid var(--tc-diag-panel-border, #eee);",
		"  display: flex;",
		"  align-items: flex-start;",
		"  gap: 8px;",
		"}",
		"." + PANEL_CLASS + "-item:last-child {",
		"  border-bottom: none;",
		"}",
		"." + PANEL_CLASS + "-item:hover {",
		"  background: var(--tc-diag-panel-hover, #f8f9fa);",
		"}",
		"." + PANEL_CLASS + "-icon {",
		"  flex: 0 0 auto;",
		"  width: 16px;",
		"  text-align: center;",
		"}",
		"." + PANEL_CLASS + "-icon.severity-error { color: var(--tc-diag-error, #dc3545); }",
		"." + PANEL_CLASS + "-icon.severity-warning { color: var(--tc-diag-warning, #ffc107); }",
		"." + PANEL_CLASS + "-icon.severity-info { color: var(--tc-diag-info, #17a2b8); }",
		"." + PANEL_CLASS + "-content {",
		"  flex: 1;",
		"  min-width: 0;",
		"}",
		"." + PANEL_CLASS + "-message {",
		"  word-break: break-word;",
		"}",
		"." + PANEL_CLASS + "-location {",
		"  color: var(--tc-diag-location, #888);",
		"  font-size: 11px;",
		"  margin-top: 2px;",
		"}"
	].join("\n");

	(doc.head || doc.documentElement).appendChild(this.styleEl);
};

DiagnosticsPlugin.prototype.removeStyles = function() {
	if(this.styleEl && this.styleEl.parentNode) {
		this.styleEl.parentNode.removeChild(this.styleEl);
	}
	this.styleEl = null;
};

// ==================== EVENT HOOKS ====================

DiagnosticsPlugin.prototype.onAfterInput = function() {
	if(!this.enabled) return;
	this.schedule();
};

DiagnosticsPlugin.prototype.onRender = function() {
	if(!this.enabled) return;
	this.renderMarkers();
};

DiagnosticsPlugin.prototype.onBlur = function() {
	// Keep diagnostics visible
};

DiagnosticsPlugin.prototype.onFocus = function() {
	if(!this.enabled) return;
	this.schedule();
};

// ==================== SCHEDULING ====================

DiagnosticsPlugin.prototype.schedule = function() {
	var self = this;

	if(this.timer) {
		clearTimeout(this.timer);
	}

	this.timer = setTimeout(function() {
		self.timer = null;
		self.update();
	}, this.options.debounceMs);
};

// ==================== ANALYSIS ====================

DiagnosticsPlugin.prototype.update = function() {
	if(!this.enabled) return;

	var text = this.engine.domNode.value;

	// Skip if text hasn't changed
	if(text === this.lastText) {
		return;
	}
	this.lastText = text;

	// Clear previous diagnostics
	this.diagnostics = [];

	// Run checks
	if(this.options.checkBalanced) {
		this.checkBalancedTokens(text);
	}

	if(this.options.checkBrackets) {
		this.checkBrackets(text);
	}

	if(this.options.checkLinks) {
		this.checkLinks(text);
	}

	if(this.options.checkDuplicateHeadings) {
		this.checkDuplicateHeadings(text);
	}

	// Sort by position
	this.diagnostics.sort(function(a, b) {
		return a.start - b.start;
	});

	// Render
	this.renderBadge();
	this.renderMarkers();

	if(this.options.showPanel && this.panel) {
		this.renderPanel();
	}
};

// ==================== CHECKS ====================

DiagnosticsPlugin.prototype.checkBalancedTokens = function(text) {
	// Symmetric tokens that must appear in pairs
	var symmetricTokens = ["''", "//", "__", "~~", "^^", ",,", "```"];

	for(var i = 0; i < symmetricTokens.length; i++) {
		var token = symmetricTokens[i];
		var positions = this.findAllPositions(text, token);

		if(positions.length % 2 !== 0) {
			// Find the last occurrence (likely the unclosed one)
			var lastPos = positions[positions.length - 1];
			var lineInfo = this.getLineInfo(text, lastPos);

			this.diagnostics.push({
				severity: SEVERITY.WARNING,
				message: "Unbalanced " + token + " token",
				start: lastPos,
				end: lastPos + token.length,
				line: lineInfo.line,
				column: lineInfo.column
			});
		}
	}

	// Asymmetric pairs
	var pairs = [
		{ open: "[[", close: "]]", name: "link brackets" },
		{ open: "{{", close: "}}", name: "transclusion braces" },
		{ open: "<<", close: ">>", name: "macro brackets" }
	];

	for(i = 0; i < pairs.length; i++) {
		var pair = pairs[i];
		var openPositions = this.findAllPositions(text, pair.open);
		var closePositions = this.findAllPositions(text, pair.close);

		if(openPositions.length > closePositions.length) {
			// Find unclosed opens
			var unclosed = this.findUnclosedPairs(text, pair.open, pair.close);
			for(var j = 0; j < unclosed.length; j++) {
				var pos = unclosed[j];
				var lineInfo = this.getLineInfo(text, pos);

				this.diagnostics.push({
					severity: SEVERITY.ERROR,
					message: "Unclosed " + pair.name + " at line " + (lineInfo.line + 1),
					start: pos,
					end: pos + pair.open.length,
					line: lineInfo.line,
					column: lineInfo.column
				});
			}
		} else if(closePositions.length > openPositions.length) {
			// Find unmatched closes
			for(j = 0; j < closePositions.length; j++) {
				var closePos = closePositions[j];
				// Check if this close has a matching open before it
				var opensBefore = openPositions.filter(function(op) { return op < closePos; }).length;
				var closesBefore = closePositions.filter(function(cp) { return cp < closePos; }).length;

				if(closesBefore >= opensBefore) {
					var lineInfo = this.getLineInfo(text, closePos);
					this.diagnostics.push({
						severity: SEVERITY.ERROR,
						message: "Unmatched " + pair.close,
						start: closePos,
						end: closePos + pair.close.length,
						line: lineInfo.line,
						column: lineInfo.column
					});
					break;
				}
			}
		}
	}
};

DiagnosticsPlugin.prototype.checkBrackets = function(text) {
	// Single-character brackets
	var brackets = [
		{ open: "(", close: ")" },
		{ open: "[", close: "]" },
		{ open: "{", close: "}" }
	];

	for(var i = 0; i < brackets.length; i++) {
		var pair = brackets[i];
		var stack = [];

		for(var j = 0; j < text.length; j++) {
			var ch = text[j];

			if(ch === pair.open) {
				stack.push(j);
			} else if(ch === pair.close) {
				if(stack.length > 0) {
					stack.pop();
				} else {
					// Unmatched close
					var lineInfo = this.getLineInfo(text, j);
					this.diagnostics.push({
						severity: SEVERITY.INFO,
						message: "Unmatched " + pair.close,
						start: j,
						end: j + 1,
						line: lineInfo.line,
						column: lineInfo.column
					});
				}
			}
		}

		// Remaining opens are unclosed
		for(var k = 0; k < stack.length; k++) {
			var pos = stack[k];
			var lineInfo = this.getLineInfo(text, pos);
			this.diagnostics.push({
				severity: SEVERITY.INFO,
				message: "Unclosed " + pair.open,
				start: pos,
				end: pos + 1,
				line: lineInfo.line,
				column: lineInfo.column
			});
		}
	}
};

DiagnosticsPlugin.prototype.checkLinks = function(text) {
	// Check for potentially broken links (links to non-existent tiddlers)
	var wiki = this.engine.wiki;
	if(!wiki) return;

	var linkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
	var match;

	while((match = linkPattern.exec(text)) !== null) {
		var target = match[1].trim();

		// Skip external links
		if(/^https?:\/\//.test(target)) continue;

		// Check if tiddler exists
		if(!wiki.tiddlerExists(target)) {
			var lineInfo = this.getLineInfo(text, match.index);
			this.diagnostics.push({
				severity: SEVERITY.INFO,
				message: 'Link target "' + target + '" does not exist',
				start: match.index,
				end: match.index + match[0].length,
				line: lineInfo.line,
				column: lineInfo.column
			});
		}
	}
};

DiagnosticsPlugin.prototype.checkDuplicateHeadings = function(text) {
	var headingPattern = /^(!{1,6})\s+(.+)$/gm;
	var headings = {};
	var match;

	while((match = headingPattern.exec(text)) !== null) {
		var level = match[1].length;
		var title = match[2].trim();
		var key = level + ":" + title;

		if(headings[key]) {
			var lineInfo = this.getLineInfo(text, match.index);
			this.diagnostics.push({
				severity: SEVERITY.WARNING,
				message: 'Duplicate heading "' + title + '"',
				start: match.index,
				end: match.index + match[0].length,
				line: lineInfo.line,
				column: lineInfo.column
			});
		} else {
			headings[key] = true;
		}
	}
};

// ==================== HELPER METHODS ====================

DiagnosticsPlugin.prototype.findAllPositions = function(text, token) {
	var positions = [];
	var index = 0;

	while((index = text.indexOf(token, index)) !== -1) {
		positions.push(index);
		index += token.length;
	}

	return positions;
};

DiagnosticsPlugin.prototype.findUnclosedPairs = function(text, open, close) {
	var unclosed = [];
	var stack = [];

	var openPositions = this.findAllPositions(text, open);
	var closePositions = this.findAllPositions(text, close);

	var allPositions = [];
	for(var i = 0; i < openPositions.length; i++) {
		allPositions.push({ pos: openPositions[i], type: "open" });
	}
	for(i = 0; i < closePositions.length; i++) {
		allPositions.push({ pos: closePositions[i], type: "close" });
	}

	allPositions.sort(function(a, b) { return a.pos - b.pos; });

	for(i = 0; i < allPositions.length; i++) {
		var item = allPositions[i];
		if(item.type === "open") {
			stack.push(item.pos);
		} else if(stack.length > 0) {
			stack.pop();
		}
	}

	return stack;
};

DiagnosticsPlugin.prototype.getLineInfo = function(text, position) {
	var before = text.substring(0, position);
	var lines = before.split("\n");
	var line = lines.length - 1;
	var column = lines[lines.length - 1].length;

	return { line: line, column: column };
};

// ==================== RENDERING ====================

DiagnosticsPlugin.prototype.clear = function() {
	this.clearMarkers();
	this.clearBadge();
	this.clearPanel();
	this.diagnostics = [];
	this.lastText = null;
};

DiagnosticsPlugin.prototype.clearMarkers = function() {
	for(var i = 0; i < this.markers.length; i++) {
		var el = this.markers[i];
		if(el && el.parentNode) {
			el.parentNode.removeChild(el);
		}
	}
	this.markers = [];
};

DiagnosticsPlugin.prototype.clearBadge = function() {
	if(this.badge && this.badge.parentNode) {
		this.badge.parentNode.removeChild(this.badge);
	}
	this.badge = null;
};

DiagnosticsPlugin.prototype.clearPanel = function() {
	if(this.panel && this.panel.parentNode) {
		this.panel.parentNode.removeChild(this.panel);
	}
	this.panel = null;
};

DiagnosticsPlugin.prototype.renderBadge = function() {
	if(!this.options.showBadge) {
		this.clearBadge();
		return;
	}

	var layer = this.engine.getDecorationLayer && this.engine.getDecorationLayer();
	if(!layer) return;

	var doc = this.engine.getDocument();

	// Remove old badge
	this.clearBadge();

	// Create new badge
	this.badge = doc.createElement("div");
	this.badge.className = BADGE_CLASS;

	var errorCount = 0;
	var warningCount = 0;
	var infoCount = 0;

	for(var i = 0; i < this.diagnostics.length; i++) {
		switch(this.diagnostics[i].severity) {
			case SEVERITY.ERROR: errorCount++; break;
			case SEVERITY.WARNING: warningCount++; break;
			case SEVERITY.INFO: infoCount++; break;
		}
	}

	if(errorCount > 0) {
		this.badge.classList.add("has-errors");
		this.badge.innerHTML = "⚠ " + errorCount + " error" + (errorCount > 1 ? "s" : "");
		if(warningCount > 0) {
			this.badge.innerHTML += ", " + warningCount + " warning" + (warningCount > 1 ? "s" : "");
		}
	} else if(warningCount > 0) {
		this.badge.classList.add("has-warnings");
		this.badge.innerHTML = "⚠ " + warningCount + " warning" + (warningCount > 1 ? "s" : "");
	} else if(infoCount > 0) {
		this.badge.classList.add("all-ok");
		this.badge.innerHTML = "ℹ " + infoCount + " note" + (infoCount > 1 ? "s" : "");
	} else {
		this.badge.classList.add("all-ok");
		this.badge.innerHTML = "✓ No issues";
	}

	// Click to toggle panel
	var self = this;
	this.badge.addEventListener("click", function(e) {
		e.preventDefault();
		e.stopPropagation();
		self.togglePanel();
	});

	layer.appendChild(this.badge);
};

DiagnosticsPlugin.prototype.renderMarkers = function() {
	this.clearMarkers();

	if(!this.options.showInlineMarkers) return;
	if(this.diagnostics.length === 0) return;

	var layer = this.engine.getDecorationLayer && this.engine.getDecorationLayer();
	if(!layer) return;

	var doc = this.engine.getDocument();

	// Limit rendering for performance
	var maxMarkers = 50;

	for(var i = 0; i < this.diagnostics.length && i < maxMarkers; i++) {
		var diag = this.diagnostics[i];
		var rects = this.engine.getRectsForRange ? this.engine.getRectsForRange(diag.start, diag.end) : null;

		if(!rects || rects.length === 0) continue;

		for(var r = 0; r < rects.length; r++) {
			var rect = rects[r];
			var marker = doc.createElement("div");
			marker.className = MARKER_CLASS + " severity-" + diag.severity;
			marker.style.left = rect.left + "px";
			marker.style.top = (rect.top + rect.height - 3) + "px";
			marker.style.width = Math.max(rect.width, 4) + "px";
			marker.style.height = "3px";
			marker.title = diag.message;

			layer.appendChild(marker);
			this.markers.push(marker);
		}
	}
};

DiagnosticsPlugin.prototype.togglePanel = function() {
	if(this.panel) {
		this.clearPanel();
	} else {
		this.showPanel();
	}
};

DiagnosticsPlugin.prototype.showPanel = function() {
	if(this.diagnostics.length === 0) return;

	var layer = this.engine.getDecorationLayer && this.engine.getDecorationLayer();
	if(!layer) return;

	var doc = this.engine.getDocument();

	this.panel = doc.createElement("div");
	this.panel.className = PANEL_CLASS;

	var self = this;

	for(var i = 0; i < this.diagnostics.length; i++) {
		var diag = this.diagnostics[i];

		var item = doc.createElement("div");
		item.className = PANEL_CLASS + "-item";

		// Icon
		var icon = doc.createElement("div");
		icon.className = PANEL_CLASS + "-icon severity-" + diag.severity;
		icon.textContent = diag.severity === SEVERITY.ERROR ? "✖" :
		                   diag.severity === SEVERITY.WARNING ? "⚠" : "ℹ";
		item.appendChild(icon);

		// Content
		var content = doc.createElement("div");
		content.className = PANEL_CLASS + "-content";

		var message = doc.createElement("div");
		message.className = PANEL_CLASS + "-message";
		message.textContent = diag.message;
		content.appendChild(message);

		var location = doc.createElement("div");
		location.className = PANEL_CLASS + "-location";
		location.textContent = "Line " + (diag.line + 1) + ", column " + (diag.column + 1);
		content.appendChild(location);

		item.appendChild(content);

		// Click to jump
		(function(d) {
			item.addEventListener("click", function(e) {
				e.preventDefault();
				self.jumpToDiagnostic(d);
			});
		})(diag);

		this.panel.appendChild(item);
	}

	layer.appendChild(this.panel);
};

DiagnosticsPlugin.prototype.renderPanel = function() {
	this.clearPanel();
	if(this.diagnostics.length > 0) {
		this.showPanel();
	}
};

DiagnosticsPlugin.prototype.jumpToDiagnostic = function(diag) {
	var ta = this.engine.domNode;
	if(!ta) return;

	ta.setSelectionRange(diag.start, diag.end);
	this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();

	// Scroll into view
	if(this.engine.getCoordinatesForPosition) {
		var coords = this.engine.getCoordinatesForPosition(diag.start);
		if(coords) {
			var scrollTop = ta.scrollTop;
			var viewHeight = ta.clientHeight;
			var posY = coords.top + scrollTop;

			if(posY < scrollTop || posY > scrollTop + viewHeight - 50) {
				ta.scrollTop = Math.max(0, posY - viewHeight / 3);
			}
		}
	}

	// Close panel
	this.clearPanel();

	// Focus textarea
	ta.focus();
};