/*\
title: $:/plugins/tiddlywiki/editor/structural-selection/structural-selection.js
type: application/javascript
module-type: editor-plugin

Enhanced structural selection with:
- Expand/shrink selection by semantic units
- Better wikitext structure awareness
- Code block boundaries
- List item boundaries
- Table cell/row boundaries
- Paragraph boundaries
- Quote block boundaries
- Multi-cursor support
- Visual feedback for current selection level

Keyboard shortcuts:
- Alt+Shift+Up: Expand selection
- Alt+Shift+Down: Shrink selection
- Ctrl+Alt+A: Select all occurrences of current word
- Ctrl+Shift+Space: Select current block

\*/

"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "structural-selection";
exports.configTiddler = "$:/config/Editor/EnableStructuralSelection";
exports.defaultEnabled = true;
exports.description = "Expand/shrink selection by semantic wikitext units";
exports.category = "editing";
exports.supports = { simple: true, framed: true };

exports.create = function(engine) { return new StructuralSelectionPlugin(engine); };

// ==================== SELECTION LEVELS ====================
var LEVELS = {
	CARET: "caret",
	WORD: "word",
	MARKUP: "markup",
	LINE: "line",
	BLOCK: "block",       // paragraph, list item, table cell
	SECTION: "section",   // heading section
	DOCUMENT: "document"
};

// ==================== PLUGIN IMPLEMENTATION ====================

function StructuralSelectionPlugin(engine) {
	this.engine = engine;
	this.name = "structural-selection";
	this.enabled = false;

	// Selection expansion stack per focus session
	this.stack = [];
	this.currentLevel = null;

	// UI
	this.indicator = null;
	this.styleEl = null;

	// Options
	this.options = {
		showIndicator: true,
		indicatorTimeout: 1500
	};

	this.indicatorTimer = null;

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this),
		focus: this.onFocus.bind(this),
		blur: this.onBlur.bind(this)
	};
}

// ==================== LIFECYCLE ====================

StructuralSelectionPlugin.prototype.enable = function() {
	this.enabled = true;
	this.injectStyles();
};

StructuralSelectionPlugin.prototype.disable = function() {
	this.enabled = false;
	this.stack = [];
	this.hideIndicator();
	this.removeStyles();
};

StructuralSelectionPlugin.prototype.destroy = function() {
	this.disable();
};

StructuralSelectionPlugin.prototype.configure = function(options) {
	if(!options) return;
	for(var key in options) {
		if(this.options.hasOwnProperty(key)) {
			this.options[key] = options[key];
		}
	}
};

// ==================== STYLES ====================

StructuralSelectionPlugin.prototype.injectStyles = function() {
	if(this.styleEl) return;

	var doc = this.engine.getDocument ? this.engine.getDocument() : document;
	if(!doc) return;

	this.styleEl = doc.createElement("style");
	this.styleEl.textContent = [
		".tc-struct-sel-indicator {",
		"  position: absolute;",
		"  bottom: 4px;",
		"  left: 4px;",
		"  padding: 4px 10px;",
		"  font-size: 11px;",
		"  font-family: inherit;",
		"  background: var(--tc-struct-sel-bg, rgba(59,130,246,0.9));",
		"  color: var(--tc-struct-sel-fg, #fff);",
		"  border-radius: 4px;",
		"  z-index: 20;",
		"  pointer-events: none;",
		"  opacity: 0;",
		"  transition: opacity 0.2s ease;",
		"}",
		".tc-struct-sel-indicator.visible {",
		"  opacity: 1;",
		"}"
	].join("\n");

	(doc.head || doc.documentElement).appendChild(this.styleEl);
};

StructuralSelectionPlugin.prototype.removeStyles = function() {
	if(this.styleEl && this.styleEl.parentNode) {
		this.styleEl.parentNode.removeChild(this.styleEl);
	}
	this.styleEl = null;
};

// ==================== EVENT HOOKS ====================

StructuralSelectionPlugin.prototype.onFocus = function() {
	this.stack = [];
	this.currentLevel = null;
};

StructuralSelectionPlugin.prototype.onBlur = function() {
	this.stack = [];
	this.currentLevel = null;
	this.hideIndicator();
};

StructuralSelectionPlugin.prototype.onKeydown = function(event) {
	if(!this.enabled) return;

	var ctrl = event.ctrlKey || event.metaKey;

	// Alt+Shift+Up: Expand selection
	if(event.altKey && event.shiftKey && !ctrl && event.key === "ArrowUp") {
		event.preventDefault();
		this.expand();
		return false;
	}

	// Alt+Shift+Down: Shrink selection
	if(event.altKey && event.shiftKey && !ctrl && event.key === "ArrowDown") {
		event.preventDefault();
		this.shrink();
		return false;
	}

	// Ctrl+Shift+Space: Select current block
	if(ctrl && event.shiftKey && event.key === " ") {
		event.preventDefault();
		this.selectBlock();
		return false;
	}

	// Ctrl+Alt+A: Select all occurrences of current word
	if(ctrl && event.altKey && (event.key === "a" || event.key === "A")) {
		event.preventDefault();
		this.selectAllOccurrences();
		return false;
	}
};

// ==================== COMMANDS (for command palette) ====================

StructuralSelectionPlugin.prototype.getCommands = function() {
	var self = this;
	return [
		{
			name: "Expand Selection",
			shortcut: "Alt+Shift+Up",
			category: "Selection",
			run: function() { self.expand(); }
		},
		{
			name: "Shrink Selection",
			shortcut: "Alt+Shift+Down",
			category: "Selection",
			run: function() { self.shrink(); }
		},
		{
			name: "Select Block",
			shortcut: "Ctrl+Shift+Space",
			category: "Selection",
			run: function() { self.selectBlock(); }
		},
		{
			name: "Select All Occurrences",
			shortcut: "Ctrl+Alt+A",
			category: "Selection",
			run: function() { self.selectAllOccurrences(); }
		}
	];
};

// ==================== SELECTION HELPERS ====================

StructuralSelectionPlugin.prototype.getSel = function() {
	var ta = this.engine.domNode;
	var start = ta.selectionStart;
	var end = ta.selectionEnd;
	if(start > end) {
		var tmp = start;
		start = end;
		end = tmp;
	}
	return { start: start, end: end };
};

StructuralSelectionPlugin.prototype.setSel = function(start, end) {
	var ta = this.engine.domNode;
	ta.selectionStart = start;
	ta.selectionEnd = end;
	this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();
};

// ==================== EXPAND / SHRINK ====================

StructuralSelectionPlugin.prototype.expand = function() {
	var ta = this.engine.domNode;
	var text = ta.value;
	var cur = this.getSel();

	// If stack top doesn't match current selection, reset stack
	if(this.stack.length === 0 ||
	   this.stack[this.stack.length - 1].start !== cur.start ||
	   this.stack[this.stack.length - 1].end !== cur.end) {
		this.stack = [cur];
	}

	var next = this.computeNextRange(text, cur.start, cur.end);
	if(!next) return;

	this.stack.push(next);
	this.setSel(next.start, next.end);
	this.showIndicator(next.level || "expanded");
};

StructuralSelectionPlugin.prototype.shrink = function() {
	if(this.stack.length <= 1) return;

	this.stack.pop();
	var prev = this.stack[this.stack.length - 1];
	this.setSel(prev.start, prev.end);
	this.showIndicator(prev.level || "shrunk");
};

// ==================== COMPUTE NEXT RANGE ====================

StructuralSelectionPlugin.prototype.computeNextRange = function(text, start, end) {
	// Level 1: Caret → Word
	if(start === end) {
		var word = this.wordRange(text, start);
		if(word && (word.start !== start || word.end !== end)) {
			word.level = LEVELS.WORD;
			return word;
		}
	}

	// Level 2: Word/Selection → Markup (wikitext tokens)
	var markup = this.enclosingMarkupRange(text, start, end);
	if(markup && (markup.start !== start || markup.end !== end)) {
		markup.level = LEVELS.MARKUP;
		return markup;
	}

	// Level 3: Code block boundaries
	var codeBlock = this.enclosingCodeBlock(text, start, end);
	if(codeBlock && (codeBlock.start !== start || codeBlock.end !== end)) {
		codeBlock.level = "code-block";
		return codeBlock;
	}

	// Level 4: List item boundaries
	var listItem = this.enclosingListItem(text, start, end);
	if(listItem && (listItem.start !== start || listItem.end !== end)) {
		listItem.level = "list-item";
		return listItem;
	}

	// Level 5: Table cell/row boundaries
	var tableCell = this.enclosingTableCell(text, start, end);
	if(tableCell && (tableCell.start !== start || tableCell.end !== end)) {
		tableCell.level = "table-cell";
		return tableCell;
	}

	// Level 6: Quote block boundaries
	var quoteBlock = this.enclosingQuoteBlock(text, start, end);
	if(quoteBlock && (quoteBlock.start !== start || quoteBlock.end !== end)) {
		quoteBlock.level = "quote-block";
		return quoteBlock;
	}

	// Level 7: Paragraph boundaries
	var paragraph = this.enclosingParagraph(text, start, end);
	if(paragraph && (paragraph.start !== start || paragraph.end !== end)) {
		paragraph.level = "paragraph";
		return paragraph;
	}

	// Level 8: Full line(s)
	var lineStart = text.lastIndexOf("\n", start - 1) + 1;
	var lineEnd = text.indexOf("\n", end);
	if(lineEnd === -1) lineEnd = text.length;
	else lineEnd += 1;

	if(lineStart !== start || lineEnd !== end) {
		return { start: lineStart, end: lineEnd, level: LEVELS.LINE };
	}

	// Level 9: Section (by heading)
	var section = this.sectionRange(text, lineStart);
	if(section && (section.start !== start || section.end !== end)) {
		section.level = LEVELS.SECTION;
		return section;
	}

	// Level 10: Whole document
	if(start !== 0 || end !== text.length) {
		return { start: 0, end: text.length, level: LEVELS.DOCUMENT };
	}

	return null;
};

// ==================== WORD RANGE ====================

StructuralSelectionPlugin.prototype.wordRange = function(text, pos) {
	var start = pos, end = pos;

	// Expand to word characters
	while(start > 0 && /\w/.test(text[start - 1])) start--;
	while(end < text.length && /\w/.test(text[end])) end++;

	// If no word found, try non-whitespace chunk
	if(start === end) {
		start = pos;
		end = pos;
		while(start > 0 && !/\s/.test(text[start - 1])) start--;
		while(end < text.length && !/\s/.test(text[end])) end++;
	}

	return (start !== end) ? { start: start, end: end } : null;
};

// ==================== MARKUP RANGE (WIKITEXT TOKENS) ====================

StructuralSelectionPlugin.prototype.enclosingMarkupRange = function(text, start, end) {
	// Wikitext token pairs
	var pairs = [
		{ o: "[[", c: "]]" },
		{ o: "{{", c: "}}" },
		{ o: "<<", c: ">>" },
		{ o: "''", c: "''" },
		{ o: "//", c: "//" },
		{ o: "__", c: "__" },
		{ o: "~~", c: "~~" },
		{ o: "^^", c: "^^" },
		{ o: ",,", c: ",," },
		{ o: "```", c: "```" },
		{ o: "`", c: "`" },
		// HTML-style tags
		{ o: "<$", c: "/>" },
		{ o: "<$", c: "</$" }
	];

	var best = null;

	for(var i = 0; i < pairs.length; i++) {
		var r = this.findEnclosingPair(text, start, end, pairs[i].o, pairs[i].c);
		if(r && (!best || (r.end - r.start) < (best.end - best.start))) {
			best = r;
		}
	}

	// Also try to find enclosing HTML tags
	var htmlTag = this.findEnclosingHtmlTag(text, start, end);
	if(htmlTag && (!best || (htmlTag.end - htmlTag.start) < (best.end - best.start))) {
		best = htmlTag;
	}

	return best;
};

StructuralSelectionPlugin.prototype.findEnclosingPair = function(text, start, end, open, close) {
	// Search outward for nearest open before start
	var openPos = -1;
	var searchStart = start;

	// Handle symmetric tokens
	if(open === close) {
		// For symmetric tokens, count occurrences before position
		var count = 0;
		var lastPos = -1;
		var i = 0;
		while((i = text.indexOf(open, i)) !== -1 && i < start) {
			count++;
			lastPos = i;
			i += open.length;
		}
		// If odd count, we're inside a pair
		if(count % 2 === 1) {
			openPos = lastPos;
		}
	} else {
		openPos = text.lastIndexOf(open, start - 1);
	}

	if(openPos === -1) return null;

	// Find matching close after end
	var closePos = text.indexOf(close, Math.max(end, openPos + open.length));
	if(closePos === -1) return null;

	// Check if this actually encloses our selection
	var innerStart = openPos + open.length;
	var innerEnd = closePos;

	if(innerStart <= start && innerEnd >= end) {
		return { start: openPos, end: closePos + close.length };
	}

	return null;
};

StructuralSelectionPlugin.prototype.findEnclosingHtmlTag = function(text, start, end) {
	// Find enclosing <tag>...</tag>
	var tagPattern = /<(\w+)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g;
	var best = null;
	var match;

	while((match = tagPattern.exec(text)) !== null) {
		var matchStart = match.index;
		var matchEnd = match.index + match[0].length;

		// Check if this encloses our selection
		if(matchStart <= start && matchEnd >= end) {
			// Check if this is smaller than current best
			if(!best || (matchEnd - matchStart) < (best.end - best.start)) {
				best = { start: matchStart, end: matchEnd };
			}
		}

		// Optimization: stop if we've passed the selection
		if(matchStart > end) break;
	}

	return best;
};

// ==================== CODE BLOCK BOUNDARIES ====================

StructuralSelectionPlugin.prototype.enclosingCodeBlock = function(text, start, end) {
	// Find ``` code fences
	var fencePattern = /```[\s\S]*?```/g;
	var match;

	while((match = fencePattern.exec(text)) !== null) {
		var blockStart = match.index;
		var blockEnd = match.index + match[0].length;

		if(blockStart <= start && blockEnd >= end) {
			// If we're inside the code block (not at boundaries)
			if(start > blockStart + 3 || end < blockEnd - 3) {
				// Select just the content
				var contentStart = text.indexOf("\n", blockStart) + 1;
				var contentEnd = text.lastIndexOf("\n", blockEnd - 3);
				if(contentEnd < contentStart) contentEnd = blockEnd - 3;

				if(contentStart <= start && contentEnd >= end &&
				   (contentStart !== start || contentEnd !== end)) {
					return { start: contentStart, end: contentEnd };
				}
			}

			// Select whole code block
			if(blockStart !== start || blockEnd !== end) {
				return { start: blockStart, end: blockEnd };
			}
		}
	}

	return null;
};

// ==================== LIST ITEM BOUNDARIES ====================

StructuralSelectionPlugin.prototype.enclosingListItem = function(text, start, end) {
	var lines = text.split("\n");
	var pos = 0;
	var itemStart = -1;
	var itemEnd = -1;
	var currentIndent = -1;

	for(var i = 0; i < lines.length; i++) {
		var line = lines[i];
		var lineStart = pos;
		var lineEnd = pos + line.length;

		// Check if this line is a list item
		var listMatch = line.match(/^(\s*)([\*#\-]+|\d+\.)\s/);

		if(listMatch) {
			var indent = listMatch[1].length + listMatch[2].length;

			// If selection starts on or after this line
			if(lineStart <= start && lineEnd >= start) {
				itemStart = lineStart;
				currentIndent = indent;
			}

			// If we've found start and this is same or higher level, update end
			if(itemStart !== -1 && indent <= currentIndent) {
				if(lineStart <= end) {
					itemEnd = lineEnd;
				} else if(indent < currentIndent) {
					break;
				}
			}
		} else if(itemStart !== -1) {
			// Non-list line
			if(line.match(/^\s+/)) {
				// Continuation of list item
				if(lineStart <= end) {
					itemEnd = lineEnd;
				}
			} else {
				// End of list
				if(lineStart > end) break;
				itemStart = -1;
				itemEnd = -1;
			}
		}

		pos += line.length + 1;
	}

	if(itemStart !== -1 && itemEnd !== -1) {
		if(itemEnd < text.length) itemEnd++; // include newline
		if(itemStart !== start || itemEnd !== end) {
			return { start: itemStart, end: itemEnd };
		}
	}

	return null;
};

// ==================== TABLE CELL/ROW BOUNDARIES ====================

StructuralSelectionPlugin.prototype.enclosingTableCell = function(text, start, end) {
	var lines = text.split("\n");
	var pos = 0;

	for(var i = 0; i < lines.length; i++) {
		var line = lines[i];
		var lineStart = pos;
		var lineEnd = pos + line.length;

		// Check if this is a table row (starts with |)
		if(line.match(/^\|/)) {
			// Check if selection is within this line
			if(lineStart <= start && lineEnd >= end) {
				// Find cell boundaries
				var cells = [];
				var cellStart = lineStart;

				for(var j = 0; j < line.length; j++) {
					if(line[j] === "|") {
						if(j > 0) {
							cells.push({ start: cellStart, end: lineStart + j });
						}
						cellStart = lineStart + j + 1;
					}
				}

				// Find the cell containing the selection
				for(var k = 0; k < cells.length; k++) {
					var cell = cells[k];
					if(cell.start <= start && cell.end >= end) {
						if(cell.start !== start || cell.end !== end) {
							return cell;
						}
						break;
					}
				}

				// Select whole row
				if(lineStart !== start || lineEnd !== end) {
					return { start: lineStart, end: lineEnd + 1 };
				}
			}
		}

		pos += line.length + 1;
	}

	return null;
};

// ==================== QUOTE BLOCK BOUNDARIES ====================

StructuralSelectionPlugin.prototype.enclosingQuoteBlock = function(text, start, end) {
	var lines = text.split("\n");
	var pos = 0;
	var quoteStart = -1;
	var quoteEnd = -1;

	for(var i = 0; i < lines.length; i++) {
		var line = lines[i];
		var lineStart = pos;
		var lineEnd = pos + line.length;

		// Check if this line is a quote (starts with >)
		var isQuote = line.match(/^>\s?/);

		if(isQuote) {
			if(quoteStart === -1 && lineStart <= start) {
				quoteStart = lineStart;
			}
			if(lineStart <= end) {
				quoteEnd = lineEnd;
			}
		} else {
			if(quoteStart !== -1 && lineStart > end) {
				break;
			}
			if(quoteEnd !== -1 && lineStart > quoteEnd) {
				break;
			}
		}

		pos += line.length + 1;
	}

	if(quoteStart !== -1 && quoteEnd !== -1) {
		if(quoteEnd < text.length) quoteEnd++; // include newline
		if(quoteStart !== start || quoteEnd !== end) {
			return { start: quoteStart, end: quoteEnd };
		}
	}

	return null;
};

// ==================== PARAGRAPH BOUNDARIES ====================

StructuralSelectionPlugin.prototype.enclosingParagraph = function(text, start, end) {
	// A paragraph is separated by blank lines
	var paragraphs = [];
	var pattern = /\n\s*\n/g;
	var lastEnd = 0;
	var match;

	while((match = pattern.exec(text)) !== null) {
		if(match.index > lastEnd) {
			paragraphs.push({ start: lastEnd, end: match.index });
		}
		lastEnd = match.index + match[0].length;
	}

	// Last paragraph
	if(lastEnd < text.length) {
		paragraphs.push({ start: lastEnd, end: text.length });
	}

	// Find paragraph containing selection
	for(var i = 0; i < paragraphs.length; i++) {
		var p = paragraphs[i];
		if(p.start <= start && p.end >= end) {
			if(p.start !== start || p.end !== end) {
				return { start: p.start, end: p.end };
			}
			break;
		}
	}

	return null;
};

// ==================== SECTION RANGE (BY HEADING) ====================

StructuralSelectionPlugin.prototype.sectionRange = function(text, fromPos) {
	var lines = text.split("\n");
	var pos = 0;
	var lineIndex = 0;

	// Find which line fromPos is on
	for(; lineIndex < lines.length; lineIndex++) {
		var nextPos = pos + lines[lineIndex].length + 1;
		if(fromPos < nextPos) break;
		pos = nextPos;
	}

	// Walk up to find a heading
	var headLine = -1;
	var headLevel = 0;

	for(var i = lineIndex; i >= 0; i--) {
		var m = lines[i].match(/^(!{1,6})\s/);
		if(m) {
			headLine = i;
			headLevel = m[1].length;
			break;
		}
	}

	if(headLine === -1) return null;

	// Section ends at next heading of same or higher level
	var endLine = lines.length;
	for(var j = headLine + 1; j < lines.length; j++) {
		var hm = lines[j].match(/^(!{1,6})\s/);
		if(hm && hm[1].length <= headLevel) {
			endLine = j;
			break;
		}
	}

	// Convert line range to char range
	var startPos = 0;
	for(i = 0; i < headLine; i++) startPos += lines[i].length + 1;

	var endPos = 0;
	for(i = 0; i < endLine; i++) endPos += lines[i].length + 1;

	// Don't include trailing newline if at end
	if(endPos > text.length) endPos = text.length;

	return { start: startPos, end: endPos };
};

// ==================== SELECT BLOCK ====================

StructuralSelectionPlugin.prototype.selectBlock = function() {
	var ta = this.engine.domNode;
	var text = ta.value;
	var cur = this.getSel();

	// Try to find the best block containing selection
	var block = this.enclosingCodeBlock(text, cur.start, cur.end) ||
	            this.enclosingListItem(text, cur.start, cur.end) ||
	            this.enclosingTableCell(text, cur.start, cur.end) ||
	            this.enclosingQuoteBlock(text, cur.start, cur.end) ||
	            this.enclosingParagraph(text, cur.start, cur.end);

	if(block) {
		this.stack = [cur, block];
		this.setSel(block.start, block.end);
		this.showIndicator("block");
	}
};

// ==================== SELECT ALL OCCURRENCES ====================

StructuralSelectionPlugin.prototype.selectAllOccurrences = function() {
	var ta = this.engine.domNode;
	var text = ta.value;
	var cur = this.getSel();

	// Get selected text or word under cursor
	var searchText;
	if(cur.start === cur.end) {
		var word = this.wordRange(text, cur.start);
		if(!word) return;
		searchText = text.substring(word.start, word.end);
	} else {
		searchText = text.substring(cur.start, cur.end);
	}

	if(!searchText) return;

	// Find all occurrences
	var positions = [];
	var index = 0;
	while((index = text.indexOf(searchText, index)) !== -1) {
		positions.push({ start: index, end: index + searchText.length });
		index += searchText.length;
	}

	if(positions.length === 0) return;

	// If engine supports multi-cursor, add all
	if(this.engine.addCursor && this.engine.clearSecondaryCursors) {
		this.engine.clearSecondaryCursors();

		// Set primary to first
		ta.selectionStart = positions[0].start;
		ta.selectionEnd = positions[0].end;
		this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();

		// Add rest as secondary
		for(var i = 1; i < positions.length; i++) {
			this.engine.addCursor(positions[i].end, positions[i]);
		}

		this.engine.sortAndMergeCursors && this.engine.sortAndMergeCursors();
		this.engine.renderCursors && this.engine.renderCursors();

		this.showIndicator(positions.length + " selected");
	} else {
		// Fallback: just select first occurrence
		this.setSel(positions[0].start, positions[0].end);
		this.showIndicator("1 of " + positions.length);
	}
};

// ==================== INDICATOR ====================

StructuralSelectionPlugin.prototype.showIndicator = function(level) {
	if(!this.options.showIndicator) return;

	var layer = this.engine.getDecorationLayer && this.engine.getDecorationLayer();
	if(!layer) {
		// Fallback for simple engine
		layer = this.engine.getWrapperNode && this.engine.getWrapperNode();
	}
	if(!layer) return;

	var doc = this.engine.getDocument ? this.engine.getDocument() : document;

	// Remove old indicator
	this.hideIndicator();

	// Create new indicator
	this.indicator = doc.createElement("div");
	this.indicator.className = "tc-struct-sel-indicator";
	this.indicator.textContent = level;

	layer.appendChild(this.indicator);

	// Show with animation
	var self = this;
	requestAnimationFrame(function() {
		if(self.indicator) {
			self.indicator.classList.add("visible");
		}
	});

	// Auto-hide
	if(this.indicatorTimer) clearTimeout(this.indicatorTimer);
	this.indicatorTimer = setTimeout(function() {
		self.hideIndicator();
	}, this.options.indicatorTimeout);
};

StructuralSelectionPlugin.prototype.hideIndicator = function() {
	if(this.indicatorTimer) {
		clearTimeout(this.indicatorTimer);
		this.indicatorTimer = null;
	}

	if(this.indicator && this.indicator.parentNode) {
		this.indicator.parentNode.removeChild(this.indicator);
	}
	this.indicator = null;
};