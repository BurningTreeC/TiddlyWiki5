/*\
title: $:/plugins/tiddlywiki/editor/autocomplete/autocomplete.js
type: application/javascript
module-type: editor-plugin

Enhanced Autocomplete popup driven by user-defined config tiddlers.

Rule tiddlers:
Tag: $:/tags/Editor/Autocomplete
Fields:
- editor-prefix: string that triggers autocomplete (required)
- editor-filter: filter that yields suggestion titles (required)
  The filter receives the variable "query" containing text after prefix

Optional fields:
- editor-insert: insert template with $title$ placeholder (default "$title$")
- editor-max: max entries (default 20)
- editor-minchars: min chars after prefix before showing (default 0)
- editor-fuzzy: enable fuzzy matching "yes"/"no" (default "no")
- editor-description-field: field to show as description (default none)
- editor-icon-field: field containing icon reference (default none)
- editor-sort: sort order "alpha"/"relevance"/"none" (default "relevance")
- editor-case-sensitive: "yes"/"no" (default "no")

\*/

"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "autocomplete";
exports.configTiddler = "$:/config/Editor/EnableAutocomplete";
exports.configTiddlerAlt = "$:/config/EnableAutocomplete";
exports.defaultEnabled = true;
exports.description = "Popup autocomplete from $:/tags/Editor/Autocomplete rules";
exports.category = "editing";
exports.supports = { simple: true, framed: true };

exports.create = function(engine) { return new AutocompletePlugin(engine); };

// ==================== CONSTANTS ====================
var POPUP_CLASS = "tc-editor-autocomplete";
var ITEM_CLASS = "tc-editor-autocomplete-item";
var ITEM_SELECTED_CLASS = "is-selected";
var ITEM_ICON_CLASS = "tc-editor-autocomplete-icon";
var ITEM_TEXT_CLASS = "tc-editor-autocomplete-text";
var ITEM_DESC_CLASS = "tc-editor-autocomplete-desc";
var DEBOUNCE_MS = 50;
var CACHE_TTL_MS = 5000;

// ==================== PLUGIN IMPLEMENTATION ====================

function AutocompletePlugin(engine) {
	this.engine = engine;
	this.name = "autocomplete";
	this.enabled = false;

	// Rule cache
	this.rules = [];
	this.rulesLastRefresh = 0;
	this.rulesRefreshInterval = 2000;

	// Filter result cache: { cacheKey: { items: [], timestamp: number } }
	this.filterCache = {};

	// UI elements
	this.popup = null;
	this.listEl = null;
	this.headerEl = null;
	this.footerEl = null;
	this.styleEl = null;

	// State
	this.selectedIndex = 0;
	this.activeRule = null;
	this.activePrefixStart = null;
	this.items = [];           // Full items array
	this.displayItems = [];    // Currently displayed (potentially filtered) items
	this.currentQuery = "";
	this.isVisible = false;

	// Debounce timer
	this.debounceTimer = null;

	this.hooks = {
		afterInput: this.onAfterInput.bind(this),
		beforeKeydown: this.onKeydown.bind(this),
		blur: this.onBlur.bind(this),
		render: this.onRender.bind(this),
		focus: this.onFocus.bind(this)
	};
}

// ==================== LIFECYCLE ====================

AutocompletePlugin.prototype.enable = function() {
	this.enabled = true;
	this.refreshRules();
	this.injectStyles();
};

AutocompletePlugin.prototype.disable = function() {
	this.enabled = false;
	this.closePopup();
	this.removeStyles();
};

AutocompletePlugin.prototype.destroy = function() {
	this.disable();
	this.filterCache = {};
	this.rules = [];
};

// ==================== STYLES ====================

AutocompletePlugin.prototype.injectStyles = function() {
	if(this.styleEl) return;

	// Styles must go in the PARENT document (main page), not iframe
	var doc = this.getParentDocument();
	if(!doc) return;

	this.styleEl = doc.createElement("style");
	this.styleEl.setAttribute("data-tc-autocomplete-styles", "true");
	this.styleEl.textContent = [
		"." + POPUP_CLASS + " {",
		"  position: absolute;",
		"  z-index: 10000;",
		"  background: var(--tc-editor-autocomplete-bg, #ffffff);",
		"  border: 1px solid var(--tc-editor-autocomplete-border, #ccc);",
		"  border-radius: 4px;",
		"  box-shadow: 0 4px 12px rgba(0,0,0,0.15);",
		"  max-height: 300px;",
		"  min-width: 200px;",
		"  max-width: 450px;",
		"  overflow: hidden;",
		"  font-family: inherit;",
		"  font-size: 0.9em;",
		"}",
		"." + POPUP_CLASS + "-header {",
		"  padding: 4px 8px;",
		"  background: var(--tc-editor-autocomplete-header-bg, #f5f5f5);",
		"  border-bottom: 1px solid var(--tc-editor-autocomplete-border, #ddd);",
		"  font-size: 0.85em;",
		"  color: var(--tc-editor-autocomplete-header-fg, #666);",
		"  display: flex;",
		"  justify-content: space-between;",
		"  align-items: center;",
		"}",
		"." + POPUP_CLASS + "-list {",
		"  max-height: 250px;",
		"  overflow-y: auto;",
		"  overflow-x: hidden;",
		"}",
		"." + POPUP_CLASS + "-footer {",
		"  padding: 4px 8px;",
		"  background: var(--tc-editor-autocomplete-footer-bg, #f9f9f9);",
		"  border-top: 1px solid var(--tc-editor-autocomplete-border, #eee);",
		"  font-size: 0.75em;",
		"  color: var(--tc-editor-autocomplete-footer-fg, #999);",
		"}",
		"." + ITEM_CLASS + " {",
		"  padding: 6px 10px;",
		"  cursor: pointer;",
		"  display: flex;",
		"  align-items: center;",
		"  gap: 8px;",
		"  border-bottom: 1px solid var(--tc-editor-autocomplete-item-border, #f0f0f0);",
		"  transition: background 0.1s ease;",
		"}",
		"." + ITEM_CLASS + ":last-child {",
		"  border-bottom: none;",
		"}",
		"." + ITEM_CLASS + ":hover {",
		"  background: var(--tc-editor-autocomplete-hover, #f5f5f5);",
		"}",
		"." + ITEM_CLASS + "." + ITEM_SELECTED_CLASS + " {",
		"  background: var(--tc-editor-autocomplete-selected, #e3f2fd);",
		"}",
		"." + ITEM_ICON_CLASS + " {",
		"  flex: 0 0 16px;",
		"  width: 16px;",
		"  height: 16px;",
		"  display: flex;",
		"  align-items: center;",
		"  justify-content: center;",
		"}",
		"." + ITEM_TEXT_CLASS + " {",
		"  flex: 1;",
		"  overflow: hidden;",
		"  text-overflow: ellipsis;",
		"  white-space: nowrap;",
		"}",
		"." + ITEM_TEXT_CLASS + " mark {",
		"  background: var(--tc-editor-autocomplete-highlight, #fff59d);",
		"  padding: 0 1px;",
		"  border-radius: 2px;",
		"}",
		"." + ITEM_DESC_CLASS + " {",
		"  flex: 0 0 auto;",
		"  max-width: 150px;",
		"  overflow: hidden;",
		"  text-overflow: ellipsis;",
		"  white-space: nowrap;",
		"  font-size: 0.85em;",
		"  color: var(--tc-editor-autocomplete-desc, #888);",
		"}",
		"." + POPUP_CLASS + "-empty {",
		"  padding: 12px;",
		"  text-align: center;",
		"  color: var(--tc-editor-autocomplete-empty, #999);",
		"  font-style: italic;",
		"}"
	].join("\n");

	(doc.head || doc.documentElement).appendChild(this.styleEl);
};

AutocompletePlugin.prototype.removeStyles = function() {
	if(this.styleEl && this.styleEl.parentNode) {
		this.styleEl.parentNode.removeChild(this.styleEl);
	}
	this.styleEl = null;
};

// ==================== RULE MANAGEMENT ====================

AutocompletePlugin.prototype.refreshRules = function() {
	var now = Date.now();
	if(now - this.rulesLastRefresh < this.rulesRefreshInterval && this.rules.length > 0) {
		return;
	}

	var wiki = this.engine && this.engine.wiki;
	if(!wiki) return;

	var titles = wiki.getTiddlersWithTag("$:/tags/Editor/Autocomplete") || [];
	var rules = [];

	for(var i = 0; i < titles.length; i++) {
		var t = wiki.getTiddler(titles[i]);
		if(!t) continue;

		var prefix = (t.fields["editor-prefix"] || "").toString();
		var filter = (t.fields["editor-filter"] || "").toString();

		if(!prefix || !filter) continue;

		rules.push({
			title: titles[i],
			prefix: prefix,
			filter: filter,
			insert: t.fields["editor-insert"] || "$title$",
			max: Math.min(100, Math.max(1, parseInt(t.fields["editor-max"] || "20", 10) || 20)),
			minChars: Math.max(0, parseInt(t.fields["editor-minchars"] || "0", 10) || 0),
			fuzzy: (t.fields["editor-fuzzy"] || "no") === "yes",
			descriptionField: t.fields["editor-description-field"] || null,
			iconField: t.fields["editor-icon-field"] || null,
			sort: t.fields["editor-sort"] || "relevance",
			caseSensitive: (t.fields["editor-case-sensitive"] || "no") === "yes"
		});
	}

	// Sort by prefix length descending (longest match first)
	rules.sort(function(a, b) { return b.prefix.length - a.prefix.length; });

	this.rules = rules;
	this.rulesLastRefresh = now;
};

// ==================== EVENT HOOKS ====================

AutocompletePlugin.prototype.onFocus = function() {
	// Refresh rules on focus
	this.refreshRules();
};

AutocompletePlugin.prototype.onRender = function() {
	if(this.isVisible) {
		this.positionPopup();
	}
};

AutocompletePlugin.prototype.onBlur = function() {
	var self = this;
	if(!this.popup) return;

	// Delay to allow click events on popup
	var self = this;
	setTimeout(function() {
		if(!self.popup) return;
		
		// Check both the iframe document and parent document
		var iframeDoc = self.getDocument();
		var parentDoc = self.getParentDocument();
		
		var ta = self.engine.domNode;
		
		// Focus could be in iframe (on textarea) or in parent doc (on popup)
		var iframeActive = iframeDoc ? iframeDoc.activeElement : null;
		var parentActive = parentDoc ? parentDoc.activeElement : null;
		
		// Don't close if focus is on textarea
		if(iframeActive === ta) return;
		
		// Don't close if focus is on popup or its children
		if(self.popup.contains(parentActive)) return;
		
		// Don't close if focus is on the iframe itself (which means focus is inside it)
		var iframe = self.getIframeElement();
		if(iframe && parentActive === iframe) return;
		
		self.closePopup();
	}, 100);
};

AutocompletePlugin.prototype.onAfterInput = function() {
	if(!this.enabled) return;

	var self = this;

	// Debounce
	if(this.debounceTimer) {
		clearTimeout(this.debounceTimer);
	}

	this.debounceTimer = setTimeout(function() {
		self.debounceTimer = null;
		self.checkTrigger();
	}, DEBOUNCE_MS);
};

AutocompletePlugin.prototype.onKeydown = function(event) {
	if(!this.enabled) return;
	if(!this.isVisible) return;

	switch(event.key) {
		case "Escape":
			event.preventDefault();
			event.stopPropagation();
			this.closePopup();
			return false;

		case "ArrowDown":
			event.preventDefault();
			this.moveSelection(1);
			return false;

		case "ArrowUp":
			event.preventDefault();
			this.moveSelection(-1);
			return false;

		case "Enter":
		case "Tab":
			if(this.displayItems.length > 0) {
				event.preventDefault();
				this.applySelection(this.selectedIndex);
				return false;
			}
			break;

		case "PageDown":
			event.preventDefault();
			this.moveSelection(5);
			return false;

		case "PageUp":
			event.preventDefault();
			this.moveSelection(-5);
			return false;

		case "Home":
			if(event.ctrlKey) {
				event.preventDefault();
				this.selectedIndex = 0;
				this.renderList();
				this.scrollToSelected();
				return false;
			}
			break;

		case "End":
			if(event.ctrlKey) {
				event.preventDefault();
				this.selectedIndex = Math.max(0, this.displayItems.length - 1);
				this.renderList();
				this.scrollToSelected();
				return false;
			}
			break;
	}
};

// ==================== TRIGGER DETECTION ====================

AutocompletePlugin.prototype.checkTrigger = function() {
	this.refreshRules();

	var textarea = this.engine.domNode;
	if(!textarea) return;

	// Don't trigger if there's a selection
	if(textarea.selectionStart !== textarea.selectionEnd) {
		this.closePopup();
		return;
	}

	var pos = textarea.selectionStart;
	var text = textarea.value || "";

	var match = this.findMatch(text, pos);
	if(!match) {
		this.closePopup();
		return;
	}

	var rule = match.rule;
	var token = text.slice(match.prefixStart, pos);
	var query = token.slice(rule.prefix.length);

	if(query.length < rule.minChars) {
		this.closePopup();
		return;
	}

	this.openOrUpdate(rule, match.prefixStart, query);
};

AutocompletePlugin.prototype.findMatch = function(text, pos) {
	// Find token: substring since last whitespace or line start
	var before = text.slice(0, pos);

	// Match non-whitespace characters at the end
	var m = before.match(/[^\s]*$/);
	var token = m ? m[0] : "";
	var tokenStart = pos - token.length;

	if(!token) return null;

	// Check rules (sorted by prefix length, longest first)
	for(var i = 0; i < this.rules.length; i++) {
		var rule = this.rules[i];
		if(token.startsWith(rule.prefix)) {
			return { rule: rule, prefixStart: tokenStart };
		}
	}

	return null;
};

// ==================== POPUP MANAGEMENT ====================

AutocompletePlugin.prototype.openOrUpdate = function(rule, prefixStart, query) {
	var wiki = this.engine.wiki;
	if(!wiki) return;

	this.activeRule = rule;
	this.activePrefixStart = prefixStart;
	this.currentQuery = query;

	// Get items from cache or filter
	var items = this.getFilteredItems(rule, query);

	// Apply client-side fuzzy filtering if enabled
	if(rule.fuzzy && query.length > 0) {
		items = this.fuzzyFilter(items, query, rule.caseSensitive);
	}

	// Sort items
	items = this.sortItems(items, query, rule);

	// Limit results
	items = items.slice(0, rule.max);

	this.items = items;
	this.displayItems = items;
	this.selectedIndex = 0;

	if(items.length === 0) {
		// No items - don't show popup
		this.closePopup();
		return;
	}

	if(!this.popup) {
		this.createPopup();
	}

	this.renderList();
	this.updateHeader();
	this.positionPopup();
	this.popup.style.display = "block";
	this.isVisible = true;
};

AutocompletePlugin.prototype.getFilteredItems = function(rule, query) {
	var wiki = this.engine.wiki;
	if(!wiki) return [];

	// Build cache key
	var cacheKey = rule.title + "::" + query;
	var now = Date.now();

	// Check cache
	if(this.filterCache[cacheKey] && (now - this.filterCache[cacheKey].timestamp) < CACHE_TTL_MS) {
		return this.filterCache[cacheKey].items.slice();
	}

	var items = [];

	try {
		// Set up filter context with query variable
		var widget = this.engine.widget;
		var oldQuery = null;
		var hadQuery = false;

		if(widget && widget.variables && widget.variables.query) {
			hadQuery = true;
			oldQuery = widget.variables.query;
		}

		if(widget && widget.setVariable) {
			widget.setVariable("query", query);
		} else if(widget && widget.variables) {
			widget.variables.query = { text: query };
		}

		// Execute filter
		items = wiki.filterTiddlers(rule.filter, widget) || [];

		// Restore previous query variable
		if(widget && widget.setVariable) {
			if(hadQuery && oldQuery !== null) {
				widget.setVariable("query", oldQuery.text !== undefined ? oldQuery.text : oldQuery);
			} else if(!hadQuery) {
				// Can't truly unset, but empty is close
				widget.setVariable("query", "");
			}
		} else if(widget && widget.variables) {
			if(hadQuery) {
				widget.variables.query = oldQuery;
			} else {
				delete widget.variables.query;
			}
		}
	} catch(e) {
		console.error("Autocomplete filter error in", rule.title, e);
		items = [];
	}

	// Store in cache
	this.filterCache[cacheKey] = {
		items: items.slice(),
		timestamp: now
	};

	// Cleanup old cache entries
	this.cleanupCache();

	return items;
};

AutocompletePlugin.prototype.cleanupCache = function() {
	var now = Date.now();
	var keys = Object.keys(this.filterCache);

	for(var i = 0; i < keys.length; i++) {
		var key = keys[i];
		if(now - this.filterCache[key].timestamp > CACHE_TTL_MS * 2) {
			delete this.filterCache[key];
		}
	}
};

AutocompletePlugin.prototype.fuzzyFilter = function(items, query, caseSensitive) {
	if(!query) return items;

	var self = this;
	var results = [];

	var q = caseSensitive ? query : query.toLowerCase();

	for(var i = 0; i < items.length; i++) {
		var item = items[i];
		var str = caseSensitive ? item : item.toLowerCase();
		var score = this.fuzzyScore(str, q);

		if(score > 0) {
			results.push({ item: item, score: score });
		}
	}

	// Sort by score descending
	results.sort(function(a, b) { return b.score - a.score; });

	return results.map(function(r) { return r.item; });
};

AutocompletePlugin.prototype.fuzzyScore = function(str, query) {
	// Simple fuzzy matching: characters must appear in order
	var score = 0;
	var strIndex = 0;
	var consecutiveBonus = 0;
	var lastMatchIndex = -1;

	for(var i = 0; i < query.length; i++) {
		var ch = query[i];
		var found = false;

		for(var j = strIndex; j < str.length; j++) {
			if(str[j] === ch) {
				found = true;
				score += 1;

				// Bonus for consecutive matches
				if(j === lastMatchIndex + 1) {
					consecutiveBonus++;
					score += consecutiveBonus;
				} else {
					consecutiveBonus = 0;
				}

				// Bonus for match at start
				if(j === 0) {
					score += 3;
				}

				// Bonus for match after separator
				if(j > 0 && /[\s\-_\/]/.test(str[j - 1])) {
					score += 2;
				}

				lastMatchIndex = j;
				strIndex = j + 1;
				break;
			}
		}

		if(!found) {
			return 0; // No match
		}
	}

	// Bonus for shorter strings (more specific match)
	score += Math.max(0, 10 - str.length);

	return score;
};

AutocompletePlugin.prototype.sortItems = function(items, query, rule) {
	if(rule.sort === "none" || !items.length) {
		return items;
	}

	var self = this;
	var wiki = this.engine.wiki;
	var q = rule.caseSensitive ? query : query.toLowerCase();

	if(rule.sort === "alpha") {
		return items.slice().sort(function(a, b) {
			return a.localeCompare(b);
		});
	}

	// Relevance sort (default)
	return items.slice().sort(function(a, b) {
		var aLower = rule.caseSensitive ? a : a.toLowerCase();
		var bLower = rule.caseSensitive ? b : b.toLowerCase();

		// Exact match first
		if(aLower === q && bLower !== q) return -1;
		if(bLower === q && aLower !== q) return 1;

		// Starts with query
		var aStarts = aLower.startsWith(q);
		var bStarts = bLower.startsWith(q);
		if(aStarts && !bStarts) return -1;
		if(bStarts && !aStarts) return 1;

		// Contains query earlier
		var aIndex = aLower.indexOf(q);
		var bIndex = bLower.indexOf(q);
		if(aIndex !== bIndex) {
			if(aIndex === -1) return 1;
			if(bIndex === -1) return -1;
			return aIndex - bIndex;
		}

		// Shorter strings first
		if(a.length !== b.length) {
			return a.length - b.length;
		}

		// Alphabetical fallback
		return a.localeCompare(b);
	});
};

// ==================== UI CREATION ====================

AutocompletePlugin.prototype.createPopup = function() {
	// Popup must be in the PARENT document (main TiddlyWiki page), not inside iframe
	var doc = this.getParentDocument();
	if(!doc) return;

	this.popup = doc.createElement("div");
	this.popup.className = POPUP_CLASS;
	this.popup.setAttribute("tabindex", "-1");
	this.popup.setAttribute("data-tc-autocomplete-popup", "true");
	this.popup.style.display = "none";

	// Header (shows current prefix/rule info)
	this.headerEl = doc.createElement("div");
	this.headerEl.className = POPUP_CLASS + "-header";
	this.popup.appendChild(this.headerEl);

	// List container
	this.listEl = doc.createElement("div");
	this.listEl.className = POPUP_CLASS + "-list";
	this.popup.appendChild(this.listEl);

	// Footer (keyboard hints)
	this.footerEl = doc.createElement("div");
	this.footerEl.className = POPUP_CLASS + "-footer";
	this.footerEl.textContent = "↑↓ Navigate • Enter/Tab Select • Esc Close";
	this.popup.appendChild(this.footerEl);

	// Event listeners
	var self = this;

	this.popup.addEventListener("mousedown", function(ev) {
		ev.preventDefault(); // Prevent focus loss
	});

	this.popup.addEventListener("click", function(ev) {
		var itemEl = ev.target.closest("[data-index]");
		if(!itemEl) return;

		var idx = parseInt(itemEl.getAttribute("data-index"), 10);
		if(!isNaN(idx)) {
			self.applySelection(idx);
		}
	});

	// Scroll event for hover selection
	this.listEl.addEventListener("mousemove", function(ev) {
		var itemEl = ev.target.closest("[data-index]");
		if(!itemEl) return;

		var idx = parseInt(itemEl.getAttribute("data-index"), 10);
		if(!isNaN(idx) && idx !== self.selectedIndex) {
			self.selectedIndex = idx;
			self.renderList();
		}
	});

	// Append to PARENT document body
	(doc.body || doc.documentElement).appendChild(this.popup);
};

AutocompletePlugin.prototype.updateHeader = function() {
	if(!this.headerEl || !this.activeRule) return;

	var rule = this.activeRule;
	var count = this.displayItems.length;
	var total = this.items.length;

	var prefixSpan = '<span style="font-weight:600">' + this.escapeHtml(rule.prefix) + '</span>';
	var countText = count + (count !== total ? "/" + total : "") + " items";

	this.headerEl.innerHTML = prefixSpan + " <span>" + countText + "</span>";
};

AutocompletePlugin.prototype.renderList = function() {
	if(!this.listEl) return;

	var doc = this.getParentDocument();
	var wiki = this.engine.wiki;
	var rule = this.activeRule;

	// Clear existing content
	this.listEl.innerHTML = "";

	if(this.displayItems.length === 0) {
		var empty = doc.createElement("div");
		empty.className = POPUP_CLASS + "-empty";
		empty.textContent = "No matches found";
		this.listEl.appendChild(empty);
		return;
	}

	var frag = doc.createDocumentFragment();

	for(var i = 0; i < this.displayItems.length; i++) {
		var title = this.displayItems[i];
		var isSelected = (i === this.selectedIndex);

		var row = doc.createElement("div");
		row.className = ITEM_CLASS + (isSelected ? " " + ITEM_SELECTED_CLASS : "");
		row.setAttribute("data-index", String(i));

		// Icon (optional)
		if(rule.iconField && wiki) {
			var tiddler = wiki.getTiddler(title);
			if(tiddler && tiddler.fields[rule.iconField]) {
				var iconDiv = doc.createElement("div");
				iconDiv.className = ITEM_ICON_CLASS;
				iconDiv.textContent = tiddler.fields[rule.iconField];
				row.appendChild(iconDiv);
			}
		}

		// Title with highlighting
		var textDiv = doc.createElement("div");
		textDiv.className = ITEM_TEXT_CLASS;
		textDiv.innerHTML = this.highlightMatch(title, this.currentQuery, rule.caseSensitive);
		row.appendChild(textDiv);

		// Description (optional)
		if(rule.descriptionField && wiki) {
			var tiddler = wiki.getTiddler(title);
			if(tiddler && tiddler.fields[rule.descriptionField]) {
				var descDiv = doc.createElement("div");
				descDiv.className = ITEM_DESC_CLASS;
				descDiv.textContent = tiddler.fields[rule.descriptionField];
				descDiv.title = tiddler.fields[rule.descriptionField]; // Full text on hover
				row.appendChild(descDiv);
			}
		}

		frag.appendChild(row);
	}

	this.listEl.appendChild(frag);
	this.scrollToSelected();
};

AutocompletePlugin.prototype.highlightMatch = function(text, query, caseSensitive) {
	if(!query) return this.escapeHtml(text);

	var escaped = this.escapeHtml(text);
	var q = caseSensitive ? query : query.toLowerCase();
	var t = caseSensitive ? text : text.toLowerCase();

	var index = t.indexOf(q);
	if(index === -1) return escaped;

	var before = this.escapeHtml(text.slice(0, index));
	var match = this.escapeHtml(text.slice(index, index + query.length));
	var after = this.escapeHtml(text.slice(index + query.length));

	return before + "<mark>" + match + "</mark>" + after;
};

AutocompletePlugin.prototype.escapeHtml = function(str) {
	return String(str)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
};

// ==================== POSITIONING ====================

AutocompletePlugin.prototype.positionPopup = function() {
	if(!this.popup) return;

	var textarea = this.engine.domNode;
	if(!textarea) return;

	var pos = textarea.selectionStart;
	
	// Get the PARENT document/window where the popup lives
	var parentDoc = this.getParentDocument();
	var parentWin = this.getParentWindow();
	if(!parentDoc || !parentWin) return;

	// Check if we're in an iframe (framed engine)
	var iframe = this.getIframeElement();
	var iframeRect = null;
	
	if(iframe) {
		// Get iframe's position in the parent document
		iframeRect = iframe.getBoundingClientRect();
	}

	// Get caret coordinates relative to textarea content area
	var coords = null;
	if(this.engine.getCoordinatesForPosition) {
		coords = this.engine.getCoordinatesForPosition(pos);
	}

	// Get textarea rect (relative to its document - could be iframe or main)
	var textareaRect = textarea.getBoundingClientRect();
	
	var left, top;

	if(iframe && iframeRect) {
		// FRAMED ENGINE: Transform coordinates from iframe to parent document
		if(coords) {
			// coords.left/top are relative to textarea content area
			// textareaRect is relative to iframe viewport
			// iframeRect is relative to parent viewport
			left = iframeRect.left + textareaRect.left + coords.left;
			top = iframeRect.top + textareaRect.top + coords.top + (coords.height || 16);
		} else {
			// Fallback: position below textarea
			left = iframeRect.left + textareaRect.left;
			top = iframeRect.top + textareaRect.bottom;
		}
	} else {
		// SIMPLE ENGINE: Direct coordinates
		if(coords) {
			if(coords.absLeft !== undefined) {
				// Simple engine provides absolute coordinates
				left = coords.absLeft;
				top = coords.absTop + (coords.absHeight || coords.height || 16);
			} else {
				left = textareaRect.left + coords.left;
				top = textareaRect.top + coords.top + (coords.height || 16);
			}
		} else {
			left = textareaRect.left;
			top = textareaRect.bottom;
		}
	}

	// Add scroll offsets of the PARENT window
	left += (parentWin.pageXOffset || parentWin.scrollX || 0);
	top += (parentWin.pageYOffset || parentWin.scrollY || 0);

	// Ensure popup stays within parent viewport
	var popupRect = this.popup.getBoundingClientRect();
	var viewWidth = parentWin.innerWidth || parentDoc.documentElement.clientWidth;
	var viewHeight = parentWin.innerHeight || parentDoc.documentElement.clientHeight;

	// Horizontal bounds
	if(left + popupRect.width > viewWidth - 10) {
		left = Math.max(10, viewWidth - popupRect.width - 10);
	}
	if(left < 10) {
		left = 10;
	}

	// Vertical bounds: flip above if no room below
	var lineHeight = (coords && coords.height) || 16;
	if(top + popupRect.height > viewHeight - 10) {
		// Try to position above the caret
		var caretTop = top - lineHeight;
		var above = caretTop - popupRect.height - 5;
		if(above > 10) {
			top = above + (parentWin.pageYOffset || parentWin.scrollY || 0);
		}
	}

	this.popup.style.left = Math.max(0, left) + "px";
	this.popup.style.top = Math.max(0, top) + "px";
	
	// Width based on iframe or textarea
	var containerWidth = iframe ? iframeRect.width : textareaRect.width;
	this.popup.style.minWidth = Math.max(160, containerWidth * 0.3) + "px";
};

// ==================== SELECTION / NAVIGATION ====================

AutocompletePlugin.prototype.moveSelection = function(delta) {
	if(this.displayItems.length === 0) return;

	this.selectedIndex += delta;

	// Wrap around
	if(this.selectedIndex < 0) {
		this.selectedIndex = this.displayItems.length - 1;
	} else if(this.selectedIndex >= this.displayItems.length) {
		this.selectedIndex = 0;
	}

	this.renderList();
};

AutocompletePlugin.prototype.scrollToSelected = function() {
	if(!this.listEl) return;

	var selectedEl = this.listEl.querySelector("." + ITEM_SELECTED_CLASS);
	if(!selectedEl) return;

	var listRect = this.listEl.getBoundingClientRect();
	var itemRect = selectedEl.getBoundingClientRect();

	if(itemRect.bottom > listRect.bottom) {
		selectedEl.scrollIntoView({ block: "end", behavior: "auto" });
	} else if(itemRect.top < listRect.top) {
		selectedEl.scrollIntoView({ block: "start", behavior: "auto" });
	}
};

AutocompletePlugin.prototype.applySelection = function(index) {
	if(!this.activeRule || this.activePrefixStart === null) return;
	if(index < 0 || index >= this.displayItems.length) return;

	var textarea = this.engine.domNode;
	if(!textarea) return;

	var pos = textarea.selectionStart;
	var title = this.displayItems[index];

	// Build insert text from template
	var insertText = this.activeRule.insert.replace(/\$title\$/g, title);

	var before = textarea.value.slice(0, this.activePrefixStart);
	var after = textarea.value.slice(pos);

	// Capture undo state if available
	if(this.engine.captureBeforeState) {
		this.engine.captureBeforeState();
	}

	textarea.value = before + insertText + after;

	var newPos = before.length + insertText.length;
	textarea.selectionStart = newPos;
	textarea.selectionEnd = newPos;

	// Sync engine state
	if(this.engine.syncCursorFromDOM) {
		this.engine.syncCursorFromDOM();
	}

	// Record undo
	if(this.engine.recordUndo) {
		this.engine.recordUndo(true);
	}

	// Trigger input handling
	if(this.engine.handleInputEvent) {
		this.engine.handleInputEvent();
	}

	// Close popup
	this.closePopup();
};

// ==================== CLEANUP ====================

AutocompletePlugin.prototype.closePopup = function() {
	// Always remove popup from DOM for clean DOM management
	if(this.popup && this.popup.parentNode) {
		this.popup.parentNode.removeChild(this.popup);
	}
	this.popup = null;
	this.listEl = null;
	this.headerEl = null;
	this.footerEl = null;

	this.isVisible = false;
	this.activeRule = null;
	this.activePrefixStart = null;
	this.items = [];
	this.displayItems = [];
	this.selectedIndex = 0;
	this.currentQuery = "";
};

// ==================== UTILITIES ====================

/**
 * Get the PARENT document (main page document) for popup insertion.
 * The popup must be in the main document, not inside the iframe.
 */
AutocompletePlugin.prototype.getParentDocument = function() {
	// Always prefer the widget's document - this is the main TiddlyWiki page
	if(this.engine.widget && this.engine.widget.document) {
		return this.engine.widget.document;
	}
	// Fallback to global document
	return document;
};

/**
 * Get the parent window (main page window) for viewport calculations.
 */
AutocompletePlugin.prototype.getParentWindow = function() {
	var doc = this.getParentDocument();
	return doc ? (doc.defaultView || window) : window;
};

/**
 * Get the iframe document (for internal engine operations).
 */
AutocompletePlugin.prototype.getDocument = function() {
	if(this.engine.getDocument) {
		return this.engine.getDocument();
	}
	if(this.engine.widget && this.engine.widget.document) {
		return this.engine.widget.document;
	}
	return document;
};

/**
 * Get the iframe window.
 */
AutocompletePlugin.prototype.getWindow = function() {
	if(this.engine.getWindow) {
		return this.engine.getWindow();
	}
	var doc = this.getDocument();
	return doc ? (doc.defaultView || window) : window;
};

/**
 * Get the iframe element if we're in a framed engine.
 */
AutocompletePlugin.prototype.getIframeElement = function() {
	return this.engine.iframeNode || null;
};