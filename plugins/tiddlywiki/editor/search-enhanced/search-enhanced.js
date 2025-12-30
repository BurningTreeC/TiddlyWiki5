/*\
title: $:/plugins/tiddlywiki/editor/search-enhanced/search-enhanced.js
type: application/javascript
module-type: editor-plugin

Enhanced in-editor search with:
- Live highlighting of all matches
- Navigation between matches (F3 / Shift+F3)
- Match count display (e.g., "3 of 12")
- Current match indicator (different highlight color)
- Case sensitivity toggle
- Whole word toggle
- Regex toggle
- Replace / Replace All functionality
- Multi-cursor selection of all matches (Ctrl+Enter)

Shortcuts:
- Ctrl+F: Open search bar
- F3 / Enter: Next match
- Shift+F3 / Shift+Enter: Previous match
- Ctrl+H: Toggle replace mode
- Ctrl+Enter: Select all matches as cursors
- Ctrl+Shift+Enter: Replace all
- Alt+C: Toggle case sensitivity
- Alt+W: Toggle whole word
- Alt+R: Toggle regex mode
- Escape: Close search

\*/

"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "search-enhanced";
exports.configTiddler = "$:/config/Editor/EnableSearchEnhanced";
exports.configTiddlerAlt = "$:/config/EnableSearchEnhanced";
exports.defaultEnabled = true;
exports.description = "In-editor search with highlighting, navigation, and replace";
exports.category = "navigation";
exports.supports = { simple: false, framed: true };

exports.create = function(engine) { return new SearchEnhancedPlugin(engine); };

// ==================== CONSTANTS ====================
var SEARCH_BAR_CLASS = "tc-search-bar";
var SEARCH_HIT_CLASS = "tc-search-hit";
var SEARCH_CURRENT_CLASS = "tc-search-current";

// ==================== PLUGIN IMPLEMENTATION ====================

function SearchEnhancedPlugin(engine) {
	this.engine = engine;
	this.name = "search-enhanced";
	this.enabled = false;

	// UI elements
	this.ui = null;
	this.searchInput = null;
	this.replaceInput = null;
	this.infoEl = null;
	this.styleEl = null;

	// State
	this.active = false;
	this.replaceMode = false;
	this.matches = [];         // Array of { start, end }
	this.currentMatchIndex = -1;

	// Options
	this.caseSensitive = false;
	this.wholeWord = false;
	this.useRegex = false;

	// Last search for persistence
	this.lastSearch = "";

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this),
		afterInput: this.onInput.bind(this),
		render: this.onRender.bind(this),
		blur: this.onBlur.bind(this),
		focus: this.onFocus.bind(this)
	};
}

// ==================== LIFECYCLE ====================

SearchEnhancedPlugin.prototype.enable = function() {
	this.enabled = true;
	this.injectStyles();
};

SearchEnhancedPlugin.prototype.disable = function() {
	this.enabled = false;
	this.close();
	this.removeStyles();
};

SearchEnhancedPlugin.prototype.destroy = function() {
	this.disable();
};

// ==================== STYLES ====================

SearchEnhancedPlugin.prototype.injectStyles = function() {
	if(this.styleEl) return;

	var doc = this.engine.getDocument();
	if(!doc) return;

	this.styleEl = doc.createElement("style");
	this.styleEl.textContent = [
		// Search hit highlight
		"." + SEARCH_HIT_CLASS + " {",
		"  position: absolute;",
		"  background: var(--tc-search-hit-bg, rgba(255, 210, 80, 0.4));",
		"  border-radius: 2px;",
		"  pointer-events: none;",
		"  z-index: 5;",
		"}",
		// Current match highlight (different color)
		"." + SEARCH_CURRENT_CLASS + " {",
		"  position: absolute;",
		"  background: var(--tc-search-current-bg, rgba(255, 140, 0, 0.6));",
		"  border: 2px solid var(--tc-search-current-border, #ff8c00);",
		"  border-radius: 2px;",
		"  pointer-events: none;",
		"  z-index: 6;",
		"  box-sizing: border-box;",
		"}"
	].join("\n");

	(doc.head || doc.documentElement).appendChild(this.styleEl);
};

SearchEnhancedPlugin.prototype.removeStyles = function() {
	if(this.styleEl && this.styleEl.parentNode) {
		this.styleEl.parentNode.removeChild(this.styleEl);
	}
	this.styleEl = null;
};

// ==================== EVENT HOOKS ====================

SearchEnhancedPlugin.prototype.onKeydown = function(event) {
	if(!this.enabled) return;

	var ctrl = event.ctrlKey || event.metaKey;

	// Ctrl+F: Open search
	if(ctrl && !event.shiftKey && !event.altKey && (event.key === "f" || event.key === "F")) {
		event.preventDefault();
		this.open(false);
		return false;
	}

	// Ctrl+H: Open search with replace
	if(ctrl && !event.shiftKey && !event.altKey && (event.key === "h" || event.key === "H")) {
		event.preventDefault();
		this.open(true);
		return false;
	}

	// When search bar is active
	if(this.active) {
		// Escape: Close
		if(event.key === "Escape") {
			event.preventDefault();
			this.close();
			return false;
		}

		// F3 / Enter: Next match
		if(event.key === "F3" || (event.key === "Enter" && !ctrl && !event.shiftKey)) {
			event.preventDefault();
			this.navigateMatch(1);
			return false;
		}

		// Shift+F3 / Shift+Enter: Previous match
		if((event.key === "F3" && event.shiftKey) || (event.key === "Enter" && event.shiftKey && !ctrl)) {
			event.preventDefault();
			this.navigateMatch(-1);
			return false;
		}

		// Ctrl+Enter: Select all matches as cursors
		if(ctrl && event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			this.selectAllMatchesAsCursors();
			return false;
		}

		// Ctrl+Shift+Enter: Replace all
		if(ctrl && event.shiftKey && event.key === "Enter") {
			event.preventDefault();
			this.replaceAll();
			return false;
		}

		// Alt+C: Toggle case sensitivity
		if(event.altKey && !ctrl && (event.key === "c" || event.key === "C")) {
			event.preventDefault();
			this.toggleCaseSensitive();
			return false;
		}

		// Alt+W: Toggle whole word
		if(event.altKey && !ctrl && (event.key === "w" || event.key === "W")) {
			event.preventDefault();
			this.toggleWholeWord();
			return false;
		}

		// Alt+R: Toggle regex
		if(event.altKey && !ctrl && (event.key === "r" || event.key === "R")) {
			event.preventDefault();
			this.toggleRegex();
			return false;
		}
	}
};

SearchEnhancedPlugin.prototype.onInput = function() {
	if(!this.active) return;
	// Recompute on text changes
	this.recompute();
};

SearchEnhancedPlugin.prototype.onRender = function() {
	if(!this.active) return;
	this.renderHighlights();
};

SearchEnhancedPlugin.prototype.onBlur = function() {
	// Keep search bar open
};

SearchEnhancedPlugin.prototype.onFocus = function() {
	if(this.active) {
		this.recompute();
	}
};

// ==================== TOGGLE METHODS ====================

SearchEnhancedPlugin.prototype.toggle = function() {
	if(this.active) {
		this.close();
	} else {
		this.open(false);
	}
};

// ==================== OPEN / CLOSE ====================

SearchEnhancedPlugin.prototype.open = function(withReplace) {
	if(this.active) {
		// Already open - just toggle replace mode if requested
		if(withReplace && !this.replaceMode) {
			this.showReplaceRow();
		}
		this.searchInput && this.searchInput.focus();
		this.searchInput && this.searchInput.select();
		return;
	}

	this.active = true;
	this.replaceMode = withReplace;
	this.createUI();

	// Pre-fill with selection if any
	var ta = this.engine.domNode;
	if(ta) {
		var selected = ta.value.substring(ta.selectionStart, ta.selectionEnd);
		if(selected && selected.indexOf("\n") === -1 && selected.length < 100) {
			this.searchInput.value = selected;
		} else if(this.lastSearch) {
			this.searchInput.value = this.lastSearch;
		}
	}

	this.recompute();
	this.searchInput.focus();
	this.searchInput.select();
};

SearchEnhancedPlugin.prototype.close = function() {
	this.active = false;
	this.clearHighlights();
	this.matches = [];
	this.currentMatchIndex = -1;

	if(this.ui && this.ui.parentNode) {
		this.ui.parentNode.removeChild(this.ui);
	}
	this.ui = null;
	this.searchInput = null;
	this.replaceInput = null;
	this.infoEl = null;

	// Refocus editor
	if(this.engine.domNode && this.engine.domNode.focus) {
		this.engine.domNode.focus();
	}
};

// ==================== UI CREATION ====================

SearchEnhancedPlugin.prototype.createUI = function() {
	var doc = this.engine.widget.document;
	var wrap = this.engine.wrapperNode;

	this.ui = doc.createElement("div");
	this.ui.className = SEARCH_BAR_CLASS;
	this.ui.style.cssText = [
		"position: absolute;",
		"top: 0;",
		"right: 0;",
		"left: 0;",
		"background: var(--tc-search-bar-bg, #f8f9fa);",
		"border-bottom: 1px solid var(--tc-search-bar-border, #dee2e6);",
		"padding: 6px 10px;",
		"display: flex;",
		"flex-direction: column;",
		"gap: 6px;",
		"z-index: 100;",
		"font-family: inherit;",
		"font-size: 13px;",
		"box-shadow: 0 2px 8px rgba(0,0,0,0.1);"
	].join("");

	// Search row
	var searchRow = doc.createElement("div");
	searchRow.style.cssText = "display: flex; align-items: center; gap: 6px;";

	// Search input
	this.searchInput = doc.createElement("input");
	this.searchInput.type = "text";
	this.searchInput.placeholder = "Search...";
	this.searchInput.style.cssText = [
		"flex: 1;",
		"padding: 5px 8px;",
		"border: 1px solid var(--tc-input-border, #ced4da);",
		"border-radius: 4px;",
		"font-size: inherit;",
		"outline: none;"
	].join("");

	var self = this;

	this.searchInput.addEventListener("input", function() {
		self.lastSearch = self.searchInput.value;
		self.recompute();
	});

	this.searchInput.addEventListener("keydown", function(e) {
		// Prevent escape from propagating if we handle it
		if(e.key === "Escape") {
			e.stopPropagation();
		}
	});

	searchRow.appendChild(this.searchInput);

	// Toggle buttons
	searchRow.appendChild(this.createToggleButton("Aa", "Case sensitive (Alt+C)", function() {
		return self.caseSensitive;
	}, function() {
		self.toggleCaseSensitive();
	}));

	searchRow.appendChild(this.createToggleButton("W", "Whole word (Alt+W)", function() {
		return self.wholeWord;
	}, function() {
		self.toggleWholeWord();
	}));

	searchRow.appendChild(this.createToggleButton(".*", "Regex (Alt+R)", function() {
		return self.useRegex;
	}, function() {
		self.toggleRegex();
	}));

	// Navigation buttons
	var prevBtn = this.createButton("◀", "Previous (Shift+F3)", function() {
		self.navigateMatch(-1);
	});
	searchRow.appendChild(prevBtn);

	var nextBtn = this.createButton("▶", "Next (F3)", function() {
		self.navigateMatch(1);
	});
	searchRow.appendChild(nextBtn);

	// Match info
	this.infoEl = doc.createElement("span");
	this.infoEl.style.cssText = "min-width: 70px; text-align: center; color: var(--tc-search-info, #666);";
	this.infoEl.textContent = "0 matches";
	searchRow.appendChild(this.infoEl);

	// Toggle replace button
	var replaceToggle = this.createButton("⇄", "Toggle Replace (Ctrl+H)", function() {
		if(self.replaceMode) {
			self.hideReplaceRow();
		} else {
			self.showReplaceRow();
		}
	});
	searchRow.appendChild(replaceToggle);

	// Close button
	var closeBtn = this.createButton("✕", "Close (Esc)", function() {
		self.close();
	});
	closeBtn.style.marginLeft = "auto";
	searchRow.appendChild(closeBtn);

	this.ui.appendChild(searchRow);

	// Replace row (hidden initially unless replaceMode)
	this.replaceRow = doc.createElement("div");
	this.replaceRow.style.cssText = "display: flex; align-items: center; gap: 6px;";
	this.replaceRow.style.display = this.replaceMode ? "flex" : "none";

	this.replaceInput = doc.createElement("input");
	this.replaceInput.type = "text";
	this.replaceInput.placeholder = "Replace with...";
	this.replaceInput.style.cssText = this.searchInput.style.cssText;

	this.replaceRow.appendChild(this.replaceInput);

	var replaceBtn = this.createButton("Replace", "Replace current", function() {
		self.replaceCurrent();
	});
	replaceBtn.style.padding = "5px 12px";
	this.replaceRow.appendChild(replaceBtn);

	var replaceAllBtn = this.createButton("Replace All", "Replace all (Ctrl+Shift+Enter)", function() {
		self.replaceAll();
	});
	replaceAllBtn.style.padding = "5px 12px";
	this.replaceRow.appendChild(replaceAllBtn);

	this.ui.appendChild(this.replaceRow);

	wrap.appendChild(this.ui);
};

SearchEnhancedPlugin.prototype.createButton = function(text, title, onClick) {
	var doc = this.engine.widget.document;
	var btn = doc.createElement("button");
	btn.type = "button";
	btn.textContent = text;
	btn.title = title;
	btn.style.cssText = [
		"padding: 4px 8px;",
		"border: 1px solid var(--tc-btn-border, #ced4da);",
		"border-radius: 4px;",
		"background: var(--tc-btn-bg, #fff);",
		"cursor: pointer;",
		"font-size: inherit;",
		"line-height: 1;"
	].join("");

	btn.addEventListener("click", function(e) {
		e.preventDefault();
		onClick();
	});

	return btn;
};

SearchEnhancedPlugin.prototype.createToggleButton = function(text, title, isActive, onClick) {
	var self = this;
	var doc = this.engine.widget.document;
	var btn = doc.createElement("button");
	btn.type = "button";
	btn.textContent = text;
	btn.title = title;
	btn.style.cssText = [
		"padding: 4px 8px;",
		"border: 1px solid var(--tc-btn-border, #ced4da);",
		"border-radius: 4px;",
		"cursor: pointer;",
		"font-size: inherit;",
		"font-weight: 600;",
		"line-height: 1;",
		"min-width: 32px;"
	].join("");

	function updateStyle() {
		if(isActive()) {
			btn.style.background = "var(--tc-toggle-active-bg, #0d6efd)";
			btn.style.color = "var(--tc-toggle-active-fg, #fff)";
			btn.style.borderColor = "var(--tc-toggle-active-border, #0d6efd)";
		} else {
			btn.style.background = "var(--tc-btn-bg, #fff)";
			btn.style.color = "inherit";
			btn.style.borderColor = "var(--tc-btn-border, #ced4da)";
		}
	}

	updateStyle();
	btn._updateStyle = updateStyle;

	btn.addEventListener("click", function(e) {
		e.preventDefault();
		onClick();
		updateStyle();
	});

	return btn;
};

SearchEnhancedPlugin.prototype.showReplaceRow = function() {
	this.replaceMode = true;
	if(this.replaceRow) {
		this.replaceRow.style.display = "flex";
	}
};

SearchEnhancedPlugin.prototype.hideReplaceRow = function() {
	this.replaceMode = false;
	if(this.replaceRow) {
		this.replaceRow.style.display = "none";
	}
};

// ==================== TOGGLE OPTIONS ====================

SearchEnhancedPlugin.prototype.toggleCaseSensitive = function() {
	this.caseSensitive = !this.caseSensitive;
	this.updateToggleButtons();
	this.recompute();
};

SearchEnhancedPlugin.prototype.toggleWholeWord = function() {
	this.wholeWord = !this.wholeWord;
	this.updateToggleButtons();
	this.recompute();
};

SearchEnhancedPlugin.prototype.toggleRegex = function() {
	this.useRegex = !this.useRegex;
	this.updateToggleButtons();
	this.recompute();
};

SearchEnhancedPlugin.prototype.updateToggleButtons = function() {
	if(!this.ui) return;
	var buttons = this.ui.querySelectorAll("button");
	for(var i = 0; i < buttons.length; i++) {
		if(buttons[i]._updateStyle) {
			buttons[i]._updateStyle();
		}
	}
};

// ==================== SEARCH LOGIC ====================

SearchEnhancedPlugin.prototype.recompute = function() {
	this.matches = [];
	this.currentMatchIndex = -1;
	this.clearHighlights();

	if(!this.searchInput) return;

	var query = this.searchInput.value;
	if(!query) {
		this.updateInfo();
		this.engine.renderCursors && this.engine.renderCursors();
		return;
	}

	var text = this.engine.domNode.value;
	this.matches = this.findMatches(text, query);

	// Find current match (nearest to cursor position)
	if(this.matches.length > 0) {
		var cursorPos = this.engine.domNode.selectionStart;
		this.currentMatchIndex = this.findNearestMatch(cursorPos);
	}

	this.updateInfo();
	this.renderHighlights();
};

SearchEnhancedPlugin.prototype.findMatches = function(text, query) {
	var matches = [];

	try {
		var pattern;
		var flags = "g" + (this.caseSensitive ? "" : "i");

		if(this.useRegex) {
			pattern = query;
		} else {
			// Escape special regex characters
			pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}

		if(this.wholeWord) {
			pattern = "\\b" + pattern + "\\b";
		}

		var regex = new RegExp(pattern, flags);
		var match;

		while((match = regex.exec(text)) !== null) {
			matches.push({
				start: match.index,
				end: match.index + match[0].length
			});

			// Prevent infinite loop on zero-length matches
			if(match[0].length === 0) {
				regex.lastIndex++;
			}

			// Safety limit
			if(matches.length > 10000) {
				console.warn("SearchEnhanced: Too many matches, stopping at 10000");
				break;
			}
		}
	} catch(e) {
		// Invalid regex - show error
		if(this.infoEl) {
			this.infoEl.textContent = "Invalid pattern";
			this.infoEl.style.color = "var(--tc-search-error, #dc3545)";
		}
		return [];
	}

	return matches;
};

SearchEnhancedPlugin.prototype.findNearestMatch = function(cursorPos) {
	if(this.matches.length === 0) return -1;

	// Find first match at or after cursor
	for(var i = 0; i < this.matches.length; i++) {
		if(this.matches[i].start >= cursorPos) {
			return i;
		}
	}

	// Wrap to beginning
	return 0;
};

// ==================== NAVIGATION ====================

SearchEnhancedPlugin.prototype.navigateMatch = function(direction) {
	if(this.matches.length === 0) return;

	if(this.currentMatchIndex === -1) {
		this.currentMatchIndex = direction > 0 ? 0 : this.matches.length - 1;
	} else {
		this.currentMatchIndex += direction;

		// Wrap around
		if(this.currentMatchIndex < 0) {
			this.currentMatchIndex = this.matches.length - 1;
		} else if(this.currentMatchIndex >= this.matches.length) {
			this.currentMatchIndex = 0;
		}
	}

	this.goToMatch(this.currentMatchIndex);
};

SearchEnhancedPlugin.prototype.goToMatch = function(index) {
	if(index < 0 || index >= this.matches.length) return;

	var match = this.matches[index];
	var ta = this.engine.domNode;

	// Select the match
	ta.setSelectionRange(match.start, match.end);
	this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();

	// Scroll into view
	this.scrollToPosition(match.start);

	this.updateInfo();
	this.renderHighlights();
};

SearchEnhancedPlugin.prototype.scrollToPosition = function(position) {
	var ta = this.engine.domNode;
	if(!ta) return;

	// Get coordinates for position
	var coords = this.engine.getCoordinatesForPosition && this.engine.getCoordinatesForPosition(position);
	if(!coords) return;

	// Scroll textarea if position is outside visible area
	var lineHeight = coords.height || 20;
	var viewTop = ta.scrollTop;
	var viewBottom = viewTop + ta.clientHeight;
	var posTop = coords.top + ta.scrollTop;

	if(posTop < viewTop + lineHeight) {
		ta.scrollTop = Math.max(0, posTop - lineHeight * 2);
	} else if(posTop > viewBottom - lineHeight * 2) {
		ta.scrollTop = posTop - ta.clientHeight + lineHeight * 3;
	}
};

// ==================== REPLACE ====================

SearchEnhancedPlugin.prototype.replaceCurrent = function() {
	if(this.currentMatchIndex === -1 || this.matches.length === 0) return;
	if(!this.replaceInput) return;

	var replacement = this.replaceInput.value;
	var match = this.matches[this.currentMatchIndex];

	this.replaceMatch(match, replacement);

	// Recompute and navigate to next
	this.recompute();

	// Navigate to next match at same position (or next if none)
	if(this.matches.length > 0) {
		var newIndex = Math.min(this.currentMatchIndex, this.matches.length - 1);
		this.currentMatchIndex = newIndex;
		this.goToMatch(newIndex);
	}
};

SearchEnhancedPlugin.prototype.replaceAll = function() {
	if(this.matches.length === 0) return;
	if(!this.replaceInput) return;

	var replacement = this.replaceInput.value;
	var ta = this.engine.domNode;
	var text = ta.value;

	// Capture undo state
	this.engine.captureBeforeState && this.engine.captureBeforeState();

	// Replace from end to start to preserve indices
	var sortedMatches = this.matches.slice().sort(function(a, b) {
		return b.start - a.start;
	});

	for(var i = 0; i < sortedMatches.length; i++) {
		var match = sortedMatches[i];
		text = text.substring(0, match.start) + replacement + text.substring(match.end);
	}

	ta.value = text;

	// Record undo
	this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();
	this.engine.recordUndo && this.engine.recordUndo(true);
	this.engine.saveChanges && this.engine.saveChanges();
	this.engine.fixHeight && this.engine.fixHeight();

	// Recompute (should show 0 matches now if replacement doesn't match)
	this.recompute();
};

SearchEnhancedPlugin.prototype.replaceMatch = function(match, replacement) {
	var ta = this.engine.domNode;
	var text = ta.value;

	this.engine.captureBeforeState && this.engine.captureBeforeState();

	ta.value = text.substring(0, match.start) + replacement + text.substring(match.end);

	// Position cursor after replacement
	var newPos = match.start + replacement.length;
	ta.setSelectionRange(newPos, newPos);

	this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();
	this.engine.recordUndo && this.engine.recordUndo(true);
	this.engine.saveChanges && this.engine.saveChanges();
	this.engine.fixHeight && this.engine.fixHeight();
};

// ==================== MULTI-CURSOR SELECTION ====================

SearchEnhancedPlugin.prototype.selectAllMatchesAsCursors = function() {
	if(this.matches.length === 0) return;
	if(!this.engine.addCursor) {
		console.warn("SearchEnhanced: Multi-cursor not supported");
		return;
	}

	var engine = this.engine;

	// Clear existing secondary cursors
	engine.clearSecondaryCursors && engine.clearSecondaryCursors();

	// Set primary cursor to first match
	var ta = engine.domNode;
	var first = this.matches[0];
	ta.setSelectionRange(first.start, first.end);
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();

	// Add cursors for remaining matches
	for(var i = 1; i < this.matches.length; i++) {
		var m = this.matches[i];
		engine.addCursor(m.end, { start: m.start, end: m.end });
	}

	engine.sortAndMergeCursors && engine.sortAndMergeCursors();
	engine.renderCursors && engine.renderCursors();

	// Close search bar
	this.close();
};

// ==================== HIGHLIGHTING ====================

SearchEnhancedPlugin.prototype.clearHighlights = function() {
	var layer = this.engine.getDecorationLayer && this.engine.getDecorationLayer();
	if(!layer) return;

	var hits = layer.querySelectorAll("." + SEARCH_HIT_CLASS + ", ." + SEARCH_CURRENT_CLASS);
	for(var i = 0; i < hits.length; i++) {
		if(hits[i].parentNode) {
			hits[i].parentNode.removeChild(hits[i]);
		}
	}
};

SearchEnhancedPlugin.prototype.renderHighlights = function() {
	var layer = this.engine.getDecorationLayer && this.engine.getDecorationLayer();
	if(!layer) return;

	this.clearHighlights();

	var doc = this.engine.getDocument();
	if(!doc) return;

	// Limit rendering for performance
	var maxRender = 500;
	var rendered = 0;

	for(var i = 0; i < this.matches.length && rendered < maxRender; i++) {
		var m = this.matches[i];
		var isCurrent = (i === this.currentMatchIndex);
		var rects = this.engine.getRectsForRange ? this.engine.getRectsForRange(m.start, m.end) : null;

		if(!rects || rects.length === 0) continue;

		for(var r = 0; r < rects.length; r++) {
			var rect = rects[r];
			var el = doc.createElement("div");
			el.className = isCurrent ? SEARCH_CURRENT_CLASS : SEARCH_HIT_CLASS;
			el.style.left = rect.left + "px";
			el.style.top = rect.top + "px";
			el.style.width = Math.max(rect.width, 2) + "px";
			el.style.height = rect.height + "px";
			layer.appendChild(el);
			rendered++;
		}
	}
};

// ==================== INFO DISPLAY ====================

SearchEnhancedPlugin.prototype.updateInfo = function() {
	if(!this.infoEl) return;

	this.infoEl.style.color = "var(--tc-search-info, #666)";

	if(this.matches.length === 0) {
		var query = this.searchInput ? this.searchInput.value : "";
		if(query) {
			this.infoEl.textContent = "No matches";
			this.infoEl.style.color = "var(--tc-search-no-match, #dc3545)";
		} else {
			this.infoEl.textContent = "";
		}
		return;
	}

	var current = this.currentMatchIndex + 1;
	var total = this.matches.length;
	this.infoEl.textContent = current + " of " + total;
};