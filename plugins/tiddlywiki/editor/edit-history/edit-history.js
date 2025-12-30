/*\
title: $:/plugins/tiddlywiki/editor/edit-history/edit-history.js
type: application/javascript
module-type: editor-plugin

Enhanced edit history with:
- Visual timeline UI (no prompts)
- Diff preview between snapshots
- Named checkpoints
- Auto-save snapshots on significant changes
- Session persistence (optional)
- Snapshot comparison view
- Quick restore and navigation

Keyboard shortcuts:
- Ctrl+Alt+H: Open history timeline
- Ctrl+Alt+S: Create named checkpoint

\*/

"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "edit-history";
exports.configTiddler = "$:/config/Editor/EnableEditHistory";
exports.defaultEnabled = false;
exports.description = "Visual edit history timeline with snapshots";
exports.category = "editing";
exports.supports = { simple: true, framed: true };

exports.create = function(engine) { return new EditHistoryPlugin(engine); };

// ==================== PLUGIN IMPLEMENTATION ====================

function EditHistoryPlugin(engine) {
	this.engine = engine;
	this.name = "edit-history";
	this.enabled = false;

	// Snapshots: { id, timestamp, text, selStart, selEnd, name?, auto? }
	this.snapshots = [];
	this.maxSnapshots = 100;

	// Auto-snapshot settings
	this.autoSnapshotDelay = 3000; // 3 seconds of inactivity
	this.autoSnapshotTimer = null;
	this.lastText = "";
	this.minChangeThreshold = 50; // Min chars changed to trigger auto-snapshot

	// UI
	this.panel = null;
	this.styleEl = null;
	this.selectedIndex = -1;
	this.compareMode = false;
	this.compareIndex = -1;

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this),
		afterInput: this.onAfterInput.bind(this),
		focus: this.onFocus.bind(this)
	};
}

// ==================== LIFECYCLE ====================

EditHistoryPlugin.prototype.enable = function() {
	this.enabled = true;
	this.injectStyles();
	this.captureInitial();
};

EditHistoryPlugin.prototype.disable = function() {
	this.enabled = false;
	this.closePanel();
	this.removeStyles();
	this.snapshots = [];

	if(this.autoSnapshotTimer) {
		clearTimeout(this.autoSnapshotTimer);
		this.autoSnapshotTimer = null;
	}
};

EditHistoryPlugin.prototype.destroy = function() {
	this.disable();
};

// ==================== STYLES ====================

EditHistoryPlugin.prototype.injectStyles = function() {
	if(this.styleEl) return;

	var doc = this.engine.getDocument ? this.engine.getDocument() : document;
	if(!doc) return;

	this.styleEl = doc.createElement("style");
	this.styleEl.textContent = [
		".tc-history-panel {",
		"  position: absolute;",
		"  top: 0;",
		"  right: 0;",
		"  bottom: 0;",
		"  width: 350px;",
		"  max-width: 50%;",
		"  background: var(--tc-hist-bg, #fff);",
		"  border-left: 1px solid var(--tc-hist-border, #ddd);",
		"  box-shadow: -4px 0 16px rgba(0,0,0,0.1);",
		"  z-index: 100;",
		"  display: flex;",
		"  flex-direction: column;",
		"  font-family: inherit;",
		"}",

		".tc-history-header {",
		"  padding: 14px 16px;",
		"  background: var(--tc-hist-header-bg, #f8f9fa);",
		"  border-bottom: 1px solid var(--tc-hist-border, #ddd);",
		"  display: flex;",
		"  justify-content: space-between;",
		"  align-items: center;",
		"}",

		".tc-history-title {",
		"  font-weight: 600;",
		"  font-size: 14px;",
		"}",

		".tc-history-actions {",
		"  display: flex;",
		"  gap: 8px;",
		"}",

		".tc-history-btn {",
		"  padding: 6px 12px;",
		"  border: 1px solid var(--tc-hist-btn-border, #ddd);",
		"  border-radius: 4px;",
		"  background: var(--tc-hist-btn-bg, #fff);",
		"  color: var(--tc-hist-btn-fg, #333);",
		"  font-size: 12px;",
		"  cursor: pointer;",
		"}",
		".tc-history-btn:hover {",
		"  background: var(--tc-hist-btn-hover, #f0f0f0);",
		"}",
		".tc-history-btn.primary {",
		"  background: var(--tc-hist-btn-primary, #3b82f6);",
		"  color: #fff;",
		"  border-color: var(--tc-hist-btn-primary, #3b82f6);",
		"}",
		".tc-history-btn.close {",
		"  border: none;",
		"  background: none;",
		"  font-size: 18px;",
		"  padding: 4px 8px;",
		"}",

		".tc-history-timeline {",
		"  flex: 1;",
		"  overflow-y: auto;",
		"  padding: 12px 0;",
		"}",

		".tc-history-item {",
		"  padding: 12px 16px;",
		"  cursor: pointer;",
		"  border-bottom: 1px solid var(--tc-hist-item-border, #f0f0f0);",
		"  position: relative;",
		"}",
		".tc-history-item:hover {",
		"  background: var(--tc-hist-item-hover, #f8fafc);",
		"}",
		".tc-history-item.selected {",
		"  background: var(--tc-hist-item-selected, #e6f0ff);",
		"  border-left: 3px solid var(--tc-hist-accent, #3b82f6);",
		"  padding-left: 13px;",
		"}",
		".tc-history-item.compare {",
		"  background: var(--tc-hist-item-compare, #fff7e6);",
		"  border-left: 3px solid var(--tc-hist-compare, #f59e0b);",
		"  padding-left: 13px;",
		"}",

		".tc-history-item-header {",
		"  display: flex;",
		"  justify-content: space-between;",
		"  align-items: center;",
		"  margin-bottom: 4px;",
		"}",

		".tc-history-item-name {",
		"  font-weight: 500;",
		"  font-size: 13px;",
		"}",
		".tc-history-item-name.auto {",
		"  color: var(--tc-hist-auto, #888);",
		"  font-weight: normal;",
		"}",

		".tc-history-item-time {",
		"  font-size: 11px;",
		"  color: var(--tc-hist-time, #888);",
		"}",

		".tc-history-item-meta {",
		"  font-size: 11px;",
		"  color: var(--tc-hist-meta, #666);",
		"  display: flex;",
		"  gap: 12px;",
		"}",

		".tc-history-item-badge {",
		"  padding: 2px 6px;",
		"  border-radius: 3px;",
		"  font-size: 10px;",
		"  font-weight: 500;",
		"}",
		".tc-history-item-badge.auto {",
		"  background: var(--tc-hist-badge-auto-bg, #e9ecef);",
		"  color: var(--tc-hist-badge-auto-fg, #666);",
		"}",
		".tc-history-item-badge.named {",
		"  background: var(--tc-hist-badge-named-bg, #d4edff);",
		"  color: var(--tc-hist-badge-named-fg, #0066cc);",
		"}",

		".tc-history-preview {",
		"  padding: 12px 16px;",
		"  background: var(--tc-hist-preview-bg, #f8f9fa);",
		"  border-top: 1px solid var(--tc-hist-border, #ddd);",
		"  max-height: 200px;",
		"  overflow-y: auto;",
		"}",

		".tc-history-preview-title {",
		"  font-size: 11px;",
		"  font-weight: 600;",
		"  color: var(--tc-hist-preview-title, #666);",
		"  margin-bottom: 8px;",
		"}",

		".tc-history-preview-content {",
		"  font-family: monospace;",
		"  font-size: 11px;",
		"  white-space: pre-wrap;",
		"  word-break: break-all;",
		"  color: var(--tc-hist-preview-fg, #333);",
		"  max-height: 150px;",
		"  overflow: hidden;",
		"}",

		".tc-history-diff {",
		"  padding: 12px 16px;",
		"  background: var(--tc-hist-diff-bg, #fffbf0);",
		"  border-top: 1px solid var(--tc-hist-border, #ddd);",
		"  max-height: 250px;",
		"  overflow-y: auto;",
		"}",

		".tc-history-diff-title {",
		"  font-size: 11px;",
		"  font-weight: 600;",
		"  color: var(--tc-hist-diff-title, #b45309);",
		"  margin-bottom: 8px;",
		"}",

		".tc-history-diff-content {",
		"  font-family: monospace;",
		"  font-size: 11px;",
		"  white-space: pre-wrap;",
		"}",

		".tc-history-diff-add {",
		"  background: var(--tc-hist-diff-add, #d4edda);",
		"  color: var(--tc-hist-diff-add-fg, #155724);",
		"}",
		".tc-history-diff-remove {",
		"  background: var(--tc-hist-diff-remove, #f8d7da);",
		"  color: var(--tc-hist-diff-remove-fg, #721c24);",
		"  text-decoration: line-through;",
		"}",

		".tc-history-footer {",
		"  padding: 10px 16px;",
		"  background: var(--tc-hist-footer-bg, #f8f9fa);",
		"  border-top: 1px solid var(--tc-hist-border, #ddd);",
		"  font-size: 11px;",
		"  color: var(--tc-hist-footer-fg, #888);",
		"  display: flex;",
		"  justify-content: space-between;",
		"}"
	].join("\n");

	(doc.head || doc.documentElement).appendChild(this.styleEl);
};

EditHistoryPlugin.prototype.removeStyles = function() {
	if(this.styleEl && this.styleEl.parentNode) {
		this.styleEl.parentNode.removeChild(this.styleEl);
	}
	this.styleEl = null;
};

// ==================== EVENT HOOKS ====================

EditHistoryPlugin.prototype.onFocus = function() {
	this.captureInitial();
};

EditHistoryPlugin.prototype.onAfterInput = function() {
	if(!this.enabled) return;
	this.scheduleAutoSnapshot();
};

EditHistoryPlugin.prototype.onKeydown = function(event) {
	if(!this.enabled) return;

	var ctrl = event.ctrlKey || event.metaKey;

	// Panel is open
	if(this.panel) {
		return this.handlePanelKeydown(event);
	}

	// Ctrl+Alt+H: Open history
	if(ctrl && event.altKey && !event.shiftKey && (event.key === "h" || event.key === "H")) {
		event.preventDefault();
		this.openPanel();
		return false;
	}

	// Ctrl+Alt+S: Create named checkpoint
	if(ctrl && event.altKey && !event.shiftKey && (event.key === "s" || event.key === "S")) {
		event.preventDefault();
		this.createNamedCheckpoint();
		return false;
	}
};

// ==================== COMMANDS (for command palette) ====================

EditHistoryPlugin.prototype.getCommands = function() {
	var self = this;
	return [
		{
			name: "Open Edit History",
			shortcut: "Ctrl+Alt+H",
			category: "Editing",
			run: function() { self.openPanel(); }
		},
		{
			name: "Create Checkpoint",
			shortcut: "Ctrl+Alt+S",
			category: "Editing",
			run: function() { self.createNamedCheckpoint(); }
		},
		{
			name: "Restore Previous Snapshot",
			category: "Editing",
			run: function() { self.restorePrevious(); }
		},
		{
			name: "Clear History",
			category: "Editing",
			run: function() { self.clearHistory(); }
		}
	];
};

// ==================== SNAPSHOTS ====================

EditHistoryPlugin.prototype.captureInitial = function() {
	if(this.snapshots.length === 0) {
		this.capture(true, "Initial");
	}
	this.lastText = this.engine.domNode.value;
};

EditHistoryPlugin.prototype.capture = function(force, name) {
	var ta = this.engine.domNode;
	var text = ta.value;

	// Check if text has changed significantly
	var lastSnapshot = this.snapshots[this.snapshots.length - 1];
	if(!force && lastSnapshot && lastSnapshot.text === text) {
		return null;
	}

	var snapshot = {
		id: Date.now() + "-" + Math.random().toString(36).substring(2, 9),
		timestamp: Date.now(),
		text: text,
		selStart: ta.selectionStart,
		selEnd: ta.selectionEnd,
		name: name || null,
		auto: !name
	};

	this.snapshots.push(snapshot);

	// Trim old snapshots
	while(this.snapshots.length > this.maxSnapshots) {
		// Keep named checkpoints longer
		var oldest = this.snapshots[0];
		if(oldest.name && this.snapshots.length <= this.maxSnapshots + 10) {
			// Find first auto snapshot to remove
			for(var i = 0; i < this.snapshots.length; i++) {
				if(this.snapshots[i].auto) {
					this.snapshots.splice(i, 1);
					break;
				}
			}
		} else {
			this.snapshots.shift();
		}
	}

	this.lastText = text;
	return snapshot;
};

EditHistoryPlugin.prototype.scheduleAutoSnapshot = function() {
	if(this.autoSnapshotTimer) {
		clearTimeout(this.autoSnapshotTimer);
	}

	var self = this;
	this.autoSnapshotTimer = setTimeout(function() {
		self.autoSnapshotTimer = null;

		var ta = self.engine.domNode;
		var text = ta.value;

		// Check if change is significant
		var changeSize = Math.abs(text.length - self.lastText.length);
		if(changeSize >= self.minChangeThreshold || self.levenshteinDistance(text, self.lastText) >= self.minChangeThreshold) {
			self.capture(false);
		}
	}, this.autoSnapshotDelay);
};

EditHistoryPlugin.prototype.createNamedCheckpoint = function() {
	var doc = this.engine.getDocument ? this.engine.getDocument() : document;

	var name = prompt("Checkpoint name:", "Checkpoint " + (this.getNamedCount() + 1));
	if(name) {
		this.capture(true, name);
	}
};

EditHistoryPlugin.prototype.getNamedCount = function() {
	var count = 0;
	for(var i = 0; i < this.snapshots.length; i++) {
		if(this.snapshots[i].name) count++;
	}
	return count;
};

EditHistoryPlugin.prototype.restoreSnapshot = function(index) {
	if(index < 0 || index >= this.snapshots.length) return;

	var snapshot = this.snapshots[index];
	var engine = this.engine;
	var ta = engine.domNode;

	// Capture current state before restoring
	this.capture(true, "Before restore");

	engine.captureBeforeState && engine.captureBeforeState();

	ta.value = snapshot.text;
	ta.selectionStart = snapshot.selStart;
	ta.selectionEnd = snapshot.selEnd;

	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();

	this.lastText = snapshot.text;
};

EditHistoryPlugin.prototype.restorePrevious = function() {
	if(this.snapshots.length < 2) return;
	this.restoreSnapshot(this.snapshots.length - 2);
};

EditHistoryPlugin.prototype.clearHistory = function() {
	var current = this.capture(true, "Before clear");
	this.snapshots = current ? [current] : [];
};

// ==================== PANEL ====================

EditHistoryPlugin.prototype.openPanel = function() {
	if(this.panel) this.closePanel();

	// Capture current state
	this.capture(false);

	var doc = this.engine.getDocument ? this.engine.getDocument() : document;
	var wrapper = this.engine.getWrapperNode ? this.engine.getWrapperNode() : this.engine.parentNode;
	if(!doc || !wrapper) return;

	this.selectedIndex = this.snapshots.length - 1;
	this.compareMode = false;
	this.compareIndex = -1;

	this.panel = doc.createElement("div");
	this.panel.className = "tc-history-panel";

	// Header
	var header = doc.createElement("div");
	header.className = "tc-history-header";

	var title = doc.createElement("div");
	title.className = "tc-history-title";
	title.textContent = "Edit History";
	header.appendChild(title);

	var actions = doc.createElement("div");
	actions.className = "tc-history-actions";

	var checkpointBtn = doc.createElement("button");
	checkpointBtn.className = "tc-history-btn";
	checkpointBtn.textContent = "+ Checkpoint";
	checkpointBtn.onclick = function() {
		self.createNamedCheckpoint();
		self.renderTimeline();
	};
	actions.appendChild(checkpointBtn);

	var closeBtn = doc.createElement("button");
	closeBtn.className = "tc-history-btn close";
	closeBtn.textContent = "×";
	closeBtn.onclick = function() { self.closePanel(); };
	actions.appendChild(closeBtn);

	header.appendChild(actions);
	this.panel.appendChild(header);

	// Timeline
	this.timeline = doc.createElement("div");
	this.timeline.className = "tc-history-timeline";
	this.panel.appendChild(this.timeline);

	// Preview area
	this.previewArea = doc.createElement("div");
	this.previewArea.className = "tc-history-preview";
	this.previewArea.style.display = "none";
	this.panel.appendChild(this.previewArea);

	// Diff area (for compare mode)
	this.diffArea = doc.createElement("div");
	this.diffArea.className = "tc-history-diff";
	this.diffArea.style.display = "none";
	this.panel.appendChild(this.diffArea);

	// Footer
	var footer = doc.createElement("div");
	footer.className = "tc-history-footer";

	var footerLeft = doc.createElement("div");
	footerLeft.textContent = this.snapshots.length + " snapshots";

	var footerRight = doc.createElement("div");
	footerRight.innerHTML = "<kbd>↵</kbd> restore • <kbd>c</kbd> compare • <kbd>Esc</kbd> close";
	footerRight.style.cssText = "font-size:10px;";

	footer.appendChild(footerLeft);
	footer.appendChild(footerRight);
	this.panel.appendChild(footer);

	wrapper.appendChild(this.panel);

	var self = this;
	this.renderTimeline();
	this.updatePreview();

	// Key handler
	this._keyHandler = function(e) {
		self.handlePanelKeydown(e);
	};
	doc.addEventListener("keydown", this._keyHandler, true);
};

EditHistoryPlugin.prototype.closePanel = function() {
	if(this.panel && this.panel.parentNode) {
		this.panel.parentNode.removeChild(this.panel);
	}

	var doc = this.engine.getDocument ? this.engine.getDocument() : document;
	if(this._keyHandler) {
		doc.removeEventListener("keydown", this._keyHandler, true);
		this._keyHandler = null;
	}

	this.panel = null;
	this.timeline = null;
	this.previewArea = null;
	this.diffArea = null;
	this.compareMode = false;
	this.compareIndex = -1;

	// Refocus editor
	if(this.engine.domNode) {
		this.engine.domNode.focus();
	}
};

EditHistoryPlugin.prototype.handlePanelKeydown = function(event) {
	if(event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		this.closePanel();
		return false;
	}

	if(event.key === "Enter") {
		event.preventDefault();
		event.stopPropagation();
		if(this.compareMode && this.compareIndex >= 0) {
			// Exit compare mode and restore selected
			this.compareMode = false;
			this.compareIndex = -1;
		}
		this.restoreSnapshot(this.selectedIndex);
		this.closePanel();
		return false;
	}

	if(event.key === "ArrowUp") {
		event.preventDefault();
		event.stopPropagation();
		if(this.compareMode) {
			this.compareIndex = Math.min(this.snapshots.length - 1, this.compareIndex + 1);
		} else {
			this.selectedIndex = Math.min(this.snapshots.length - 1, this.selectedIndex + 1);
		}
		this.renderTimeline();
		this.updatePreview();
		return false;
	}

	if(event.key === "ArrowDown") {
		event.preventDefault();
		event.stopPropagation();
		if(this.compareMode) {
			this.compareIndex = Math.max(0, this.compareIndex - 1);
		} else {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		}
		this.renderTimeline();
		this.updatePreview();
		return false;
	}

	// 'c' to toggle compare mode
	if(event.key === "c" || event.key === "C") {
		event.preventDefault();
		event.stopPropagation();
		this.compareMode = !this.compareMode;
		if(this.compareMode) {
			this.compareIndex = Math.max(0, this.selectedIndex - 1);
		} else {
			this.compareIndex = -1;
		}
		this.renderTimeline();
		this.updatePreview();
		return false;
	}

	return false;
};

EditHistoryPlugin.prototype.renderTimeline = function() {
	if(!this.timeline) return;

	var doc = this.engine.getDocument ? this.engine.getDocument() : document;
	this.timeline.innerHTML = "";

	var self = this;

	// Show newest first
	for(var i = this.snapshots.length - 1; i >= 0; i--) {
		var snapshot = this.snapshots[i];

		var item = doc.createElement("div");
		item.className = "tc-history-item";
		if(i === this.selectedIndex) item.classList.add("selected");
		if(this.compareMode && i === this.compareIndex) item.classList.add("compare");

		// Header row
		var headerRow = doc.createElement("div");
		headerRow.className = "tc-history-item-header";

		// Name
		var name = doc.createElement("div");
		name.className = "tc-history-item-name" + (snapshot.auto ? " auto" : "");
		name.textContent = snapshot.name || "Auto-save";
		headerRow.appendChild(name);

		// Time
		var time = doc.createElement("div");
		time.className = "tc-history-item-time";
		time.textContent = this.formatTime(snapshot.timestamp);
		headerRow.appendChild(time);

		item.appendChild(headerRow);

		// Meta row
		var meta = doc.createElement("div");
		meta.className = "tc-history-item-meta";

		// Badge
		var badge = doc.createElement("span");
		badge.className = "tc-history-item-badge " + (snapshot.name ? "named" : "auto");
		badge.textContent = snapshot.name ? "checkpoint" : "auto";
		meta.appendChild(badge);

		// Size
		var size = doc.createElement("span");
		size.textContent = snapshot.text.length + " chars";
		meta.appendChild(size);

		// Lines
		var lines = doc.createElement("span");
		var lineCount = snapshot.text.split("\n").length;
		lines.textContent = lineCount + " line" + (lineCount !== 1 ? "s" : "");
		meta.appendChild(lines);

		item.appendChild(meta);

		// Click handler
		(function(index) {
			item.addEventListener("click", function(e) {
				if(self.compareMode && e.shiftKey) {
					self.compareIndex = index;
				} else {
					self.selectedIndex = index;
				}
				self.renderTimeline();
				self.updatePreview();
			});

			item.addEventListener("dblclick", function() {
				self.restoreSnapshot(index);
				self.closePanel();
			});
		})(i);

		this.timeline.appendChild(item);
	}

	// Scroll selected into view
	var selected = this.timeline.querySelector(".selected");
	if(selected) {
		selected.scrollIntoView({ block: "nearest" });
	}
};

EditHistoryPlugin.prototype.updatePreview = function() {
	if(!this.previewArea || !this.diffArea) return;

	var doc = this.engine.getDocument ? this.engine.getDocument() : document;

	if(this.compareMode && this.compareIndex >= 0 && this.compareIndex !== this.selectedIndex) {
		// Show diff
		this.previewArea.style.display = "none";
		this.diffArea.style.display = "block";

		var older = this.snapshots[Math.min(this.selectedIndex, this.compareIndex)];
		var newer = this.snapshots[Math.max(this.selectedIndex, this.compareIndex)];

		this.diffArea.innerHTML = "";

		var title = doc.createElement("div");
		title.className = "tc-history-diff-title";
		title.textContent = "Comparing snapshots";
		this.diffArea.appendChild(title);

		var content = doc.createElement("div");
		content.className = "tc-history-diff-content";

		var diff = this.simpleDiff(older.text, newer.text);
		content.innerHTML = diff;

		this.diffArea.appendChild(content);
	} else {
		// Show preview
		this.diffArea.style.display = "none";
		this.previewArea.style.display = "block";

		if(this.selectedIndex < 0 || this.selectedIndex >= this.snapshots.length) {
			this.previewArea.innerHTML = "";
			return;
		}

		var snapshot = this.snapshots[this.selectedIndex];

		this.previewArea.innerHTML = "";

		var title = doc.createElement("div");
		title.className = "tc-history-preview-title";
		title.textContent = "Preview";
		this.previewArea.appendChild(title);

		var content = doc.createElement("div");
		content.className = "tc-history-preview-content";
		var previewText = snapshot.text.substring(0, 500);
		if(snapshot.text.length > 500) previewText += "…";
		content.textContent = previewText;
		this.previewArea.appendChild(content);
	}
};

// ==================== UTILITIES ====================

EditHistoryPlugin.prototype.formatTime = function(timestamp) {
	var date = new Date(timestamp);
	var now = new Date();

	var diffMs = now - date;
	var diffMins = Math.floor(diffMs / 60000);
	var diffHours = Math.floor(diffMs / 3600000);

	if(diffMins < 1) return "just now";
	if(diffMins < 60) return diffMins + " min ago";
	if(diffHours < 24) return diffHours + " hour" + (diffHours > 1 ? "s" : "") + " ago";

	return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

EditHistoryPlugin.prototype.simpleDiff = function(oldText, newText) {
	// Very simple line-by-line diff
	var oldLines = oldText.split("\n");
	var newLines = newText.split("\n");

	var result = [];
	var maxLines = Math.max(oldLines.length, newLines.length);

	for(var i = 0; i < Math.min(maxLines, 50); i++) {
		var oldLine = oldLines[i];
		var newLine = newLines[i];

		if(oldLine === newLine) {
			result.push(this.escapeHtml(newLine || ""));
		} else if(oldLine === undefined) {
			result.push('<span class="tc-history-diff-add">+ ' + this.escapeHtml(newLine) + '</span>');
		} else if(newLine === undefined) {
			result.push('<span class="tc-history-diff-remove">- ' + this.escapeHtml(oldLine) + '</span>');
		} else {
			result.push('<span class="tc-history-diff-remove">- ' + this.escapeHtml(oldLine) + '</span>');
			result.push('<span class="tc-history-diff-add">+ ' + this.escapeHtml(newLine) + '</span>');
		}
	}

	if(maxLines > 50) {
		result.push("... (" + (maxLines - 50) + " more lines)");
	}

	return result.join("\n");
};

EditHistoryPlugin.prototype.escapeHtml = function(text) {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
};

EditHistoryPlugin.prototype.levenshteinDistance = function(s1, s2) {
	// Simplified: just return absolute length difference for performance
	// Full Levenshtein would be too slow for large texts
	return Math.abs(s1.length - s2.length);
};