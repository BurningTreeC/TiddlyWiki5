/*\
title: $:/core/modules/editor/engines/simple.js
type: application/javascript
module-type: library

Text editor engine based on a simple input or textarea tag.
Updated with plugin system support for consistency with framed engine.

\*/

"use strict";

var HEIGHT_VALUE_TITLE = "$:/config/TextEditor/EditorHeight/Height";

function SimpleEngine(options) {
	options = options || {};
	this.widget = options.widget;
	this.value = options.value || "";
	this.parentNode = options.parentNode;
	this.nextSibling = options.nextSibling;

	// Plugin system
	this.plugins = [];
	this.pluginMetadata = {};
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

	// Simple cursor model (single cursor only)
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

	// Create DOM
	this.createDOM();

	// Initialize undo system
	this.initializeUndoSystem();

	// Initialize plugins
	this.initializePlugins();

	// Sync initial state
	this.lastKnownText = this.domNode ? (this.domNode.value || "") : (this.value || "");
}

SimpleEngine.prototype.createDOM = function() {
	var tag = this.widget.editTag;
	if($tw.config.htmlUnsafeElements.indexOf(tag) !== -1) {
		tag = "input";
	}

	this.domNode = this.widget.document.createElement(tag);

	// Set the text
	if(this.widget.editTag === "textarea") {
		this.domNode.appendChild(this.widget.document.createTextNode(this.value));
	} else {
		this.domNode.value = this.value;
	}

	// Set attributes
	if(this.widget.editType && this.widget.editTag !== "textarea") {
		this.domNode.setAttribute("type", this.widget.editType);
	}
	if(this.widget.editPlaceholder) {
		this.domNode.setAttribute("placeholder", this.widget.editPlaceholder);
	}
	if(this.widget.editSize) {
		this.domNode.setAttribute("size", this.widget.editSize);
	}
	if(this.widget.editRows) {
		this.domNode.setAttribute("rows", this.widget.editRows);
	}
	if(this.widget.editClass) {
		this.domNode.className = this.widget.editClass;
	}
	if(this.widget.editTabIndex) {
		this.domNode.setAttribute("tabindex", this.widget.editTabIndex);
	}
	if(this.widget.editAutoComplete) {
		this.domNode.setAttribute("autocomplete", this.widget.editAutoComplete);
	}
	if(this.widget.isDisabled === "yes") {
		this.domNode.setAttribute("disabled", true);
	}
	if(this.widget.editReadOnly === "yes") {
		this.domNode.setAttribute("readonly", true);
	}

	// Add event listeners
	this.addEventListeners();

	// Insert into DOM
	this.parentNode.insertBefore(this.domNode, this.nextSibling);
	this.widget.domNodes.push(this.domNode);
};

SimpleEngine.prototype._on = function(target, name, handler, opts) {
	if(!target || !target.addEventListener) return;
	target.addEventListener(name, handler, opts || false);
	this._listeners.push({ target: target, name: name, handler: handler, opts: opts || false });
};

SimpleEngine.prototype._clearListeners = function() {
	for(var i = 0; i < this._listeners.length; i++) {
		var l = this._listeners[i];
		try { l.target.removeEventListener(l.name, l.handler, l.opts); } catch(e) {}
	}
	this._listeners = [];
};

SimpleEngine.prototype.addEventListeners = function() {
	var self = this;

	this._on(this.domNode, "focus", function(e) { self.handleFocusEvent(e); });
	this._on(this.domNode, "blur", function(e) { self.handleBlurEvent(e); });
	this._on(this.domNode, "input", function(e) { self.handleInputEvent(e); });
	this._on(this.domNode, "keydown", function(e) { self.handleKeydownEvent(e); });
	this._on(this.domNode, "keypress", function(e) { self.handleKeypressEvent(e); });
	this._on(this.domNode, "click", function(e) { self.handleClickEvent(e); });
	this._on(this.domNode, "select", function(e) { self.handleSelectEvent(e); });
	this._on(this.domNode, "beforeinput", function(e) { self.handleBeforeInputEvent(e); });
};

// ==================== PLUGIN SYSTEM ====================

SimpleEngine.prototype.initializePlugins = function() {
	var self = this;

	// Discover and register all editor plugins
	$tw.modules.forEachModuleOfType("editor-plugin", function(title, module) {
		if(!module || !module.create) return;

		// Collect metadata from module exports
		var metadata = {
			name: module.name || null,
			configTiddler: module.configTiddler || null,
			configTiddlerAlt: module.configTiddlerAlt || null,
			defaultEnabled: module.defaultEnabled !== undefined ? module.defaultEnabled : false,
			description: module.description || "",
			category: module.category || "misc"
		};

		try {
			var plugin = module.create(self);
			if(plugin) {
				// Store metadata by plugin name
				var pluginName = plugin.name || metadata.name;
				if(pluginName) {
					metadata.name = pluginName;
					self.pluginMetadata[pluginName] = metadata;
				}
				self.registerPlugin(plugin);
			}
		} catch(e) {
			console.error("Failed to create editor plugin:", title, e);
		}
	});
};

SimpleEngine.prototype.registerPlugin = function(plugin) {
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

SimpleEngine.prototype.getPlugin = function(name) {
	return this.plugins.find(function(p) { return p && p.name === name; });
};

SimpleEngine.prototype.hasPlugin = function(name) {
	return !!this.getPlugin(name);
};

SimpleEngine.prototype.getPluginMetadata = function() {
	return this.pluginMetadata;
};

SimpleEngine.prototype.getPluginConfigTiddlers = function() {
	var tiddlers = [];
	for(var name in this.pluginMetadata) {
		var meta = this.pluginMetadata[name];
		if(meta.configTiddler) tiddlers.push(meta.configTiddler);
		if(meta.configTiddlerAlt) tiddlers.push(meta.configTiddlerAlt);
	}
	return tiddlers;
};

SimpleEngine.prototype.enablePlugin = function(name) {
	var plugin = this.getPlugin(name);
	if(plugin && plugin.enable) {
		try { plugin.enable(); }
		catch(e) { console.error("Plugin enable error:", name, e); }
	}
};

SimpleEngine.prototype.disablePlugin = function(name) {
	var plugin = this.getPlugin(name);
	if(plugin && plugin.disable) {
		try { plugin.disable(); }
		catch(e) { console.error("Plugin disable error:", name, e); }
	}
};

SimpleEngine.prototype.enablePluginsByConfig = function(enabledMap) {
	for(var name in enabledMap) {
		if(!this.hasPlugin(name)) continue;

		var shouldEnable = (enabledMap[name] === "yes" || enabledMap[name] === true);
		if(shouldEnable) {
			this.enablePlugin(name);
		} else {
			this.disablePlugin(name);
		}
	}
};

SimpleEngine.prototype.configurePlugin = function(name, options) {
	var plugin = this.getPlugin(name);
	if(plugin && plugin.configure) {
		try { plugin.configure(options); }
		catch(e) { console.error("Plugin configure error:", name, e); }
	}
};

SimpleEngine.prototype.runHooks = function(hookName, event, data) {
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

// ==================== UNDO SYSTEM ====================

SimpleEngine.prototype.initializeUndoSystem = function() {
	this.undoStack = [];
	this.redoStack = [];
	this.pendingBeforeState = null;
	this.lastUndoTime = 0;
	this.undoGroupingDelay = 500;
	this.isUndoRedoOperation = false;
	this.lastSavedState = this.createState();
};

SimpleEngine.prototype.createState = function() {
	return {
		text: this.domNode ? (this.domNode.value || "") : (this.value || ""),
		selectionStart: this.domNode ? this.domNode.selectionStart : 0,
		selectionEnd: this.domNode ? this.domNode.selectionEnd : 0,
		timestamp: Date.now()
	};
};

SimpleEngine.prototype.captureBeforeState = function() {
	if(this.isUndoRedoOperation) return;
	if(!this.pendingBeforeState) this.pendingBeforeState = this.createState();
};

SimpleEngine.prototype.recordUndo = function(forceSeparate) {
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

SimpleEngine.prototype.applyState = function(state) {
	if(!state) return;

	this.domNode.value = state.text;
	this.lastKnownText = state.text;

	try {
		this.domNode.setSelectionRange(state.selectionStart || 0, state.selectionEnd || 0);
	} catch(e) {}

	this.syncCursorFromDOM();
	this.fixHeight();
	this.widget.saveChanges(this.getText());
};

SimpleEngine.prototype.undo = function() {
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

SimpleEngine.prototype.redo = function() {
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

SimpleEngine.prototype.canUndo = function() { return this.undoStack.length > 0; };
SimpleEngine.prototype.canRedo = function() { return this.redoStack.length > 0; };

// ==================== CURSOR MANAGEMENT ====================

SimpleEngine.prototype.getCursors = function() { return this.cursors; };
SimpleEngine.prototype.getPrimaryCursor = function() { return this.cursors[0]; };
SimpleEngine.prototype.hasMultipleCursors = function() { return false; }; // Simple engine doesn't support multi-cursor

SimpleEngine.prototype.syncCursorFromDOM = function() {
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

SimpleEngine.prototype.syncDOMFromCursor = function() {
	var primary = this.getPrimaryCursor();
	if(primary && this.domNode && this.domNode.setSelectionRange) {
		try { this.domNode.setSelectionRange(primary.start, primary.end); } catch(e) {}
	}
};

// Stub methods for multi-cursor compatibility (no-op in simple engine)
SimpleEngine.prototype.addCursor = function() { return null; };
SimpleEngine.prototype.removeCursor = function() {};
SimpleEngine.prototype.clearSecondaryCursors = function() {};
SimpleEngine.prototype.sortAndMergeCursors = function() {};
SimpleEngine.prototype.mergeCursors = function() {};
SimpleEngine.prototype.renderCursors = function() {};

// ==================== TEXT OPERATIONS ====================

SimpleEngine.prototype.setText = function(text, type) {
	if(!this.domNode.isTiddlyWikiFakeDom) {
		if(this.domNode.ownerDocument.activeElement !== this.domNode || text === "") {
			this.updateDomNodeText(text);
		}
		this.fixHeight();
	}
};

SimpleEngine.prototype.updateDomNodeText = function(text) {
	try {
		this.domNode.value = text;
		this.lastKnownText = text;
	} catch(e) {}
};

SimpleEngine.prototype.getText = function() {
	return this.domNode.value;
};

SimpleEngine.prototype.createTextOperation = function() {
	this.syncCursorFromDOM();
	var text = this.domNode.value;
	
	// Ensure we have a valid cursor
	var primary = this.getPrimaryCursor();
	if(!primary) {
		primary = {
			start: this.domNode.selectionStart || 0,
			end: this.domNode.selectionEnd || 0
		};
	}
	var start = primary.start || 0;
	var end = primary.end || start;

	var op = {
		text: text,
		selStart: start,
		selEnd: end,
		selection: text.substring(start, end),
		cutStart: null,
		cutEnd: null,
		replacement: null,
		newSelStart: null,
		newSelEnd: null
	};

	// Return as array for compatibility with multi-cursor operations
	// Also set properties on array for backward compat with old text operations
	var ops = [op];
	ops.text = op.text;
	ops.selStart = op.selStart;
	ops.selEnd = op.selEnd;
	ops.selection = op.selection;
	ops.cutStart = null;
	ops.cutEnd = null;
	ops.replacement = null;
	ops.newSelStart = null;
	ops.newSelEnd = null;

	return ops;
};

SimpleEngine.prototype.executeTextOperation = function(operations) {
	var opArray = Array.isArray(operations) ? operations : [operations];

	// Backward compatibility: old text operations set properties on the array itself
	if(Array.isArray(operations) && operations.length === 1) {
		var op0 = operations[0];
		if(operations.replacement !== null && operations.replacement !== undefined) {
			op0.replacement = operations.replacement;
		}
		if(operations.cutStart !== null && operations.cutStart !== undefined) {
			op0.cutStart = operations.cutStart;
		}
		if(operations.cutEnd !== null && operations.cutEnd !== undefined) {
			op0.cutEnd = operations.cutEnd;
		}
		if(operations.newSelStart !== null && operations.newSelStart !== undefined) {
			op0.newSelStart = operations.newSelStart;
		}
		if(operations.newSelEnd !== null && operations.newSelEnd !== undefined) {
			op0.newSelEnd = operations.newSelEnd;
		}
	}

	var op = opArray[0];
	if(!op || op.replacement === null || op.replacement === undefined) {
		return this.domNode.value;
	}

	var hookResult = this.runHooks("beforeOperation", null, opArray);
	if(hookResult.prevented) return this.domNode.value;

	opArray = hookResult.data;
	op = opArray[0];
	if(!op || op.replacement === null || op.replacement === undefined) {
		return this.domNode.value;
	}

	this.captureBeforeState();

	var text = this.domNode.value;
	
	// Handle null/undefined cutStart/cutEnd - default to selection range
	var cutStart = (op.cutStart !== null && op.cutStart !== undefined) ? op.cutStart : op.selStart;
	var cutEnd = (op.cutEnd !== null && op.cutEnd !== undefined) ? op.cutEnd : op.selEnd;
	cutStart = Math.max(0, Math.min(cutStart, text.length));
	cutEnd = Math.max(cutStart, Math.min(cutEnd, text.length));
	var replacement = String(op.replacement);

	var newText = text.substring(0, cutStart) + replacement + text.substring(cutEnd);
	this.domNode.value = newText;
	this.lastKnownText = newText;

	var newSelStart = (op.newSelStart !== null && op.newSelStart !== undefined) ? op.newSelStart : (cutStart + replacement.length);
	var newSelEnd = (op.newSelEnd !== null && op.newSelEnd !== undefined) ? op.newSelEnd : newSelStart;

	try {
		this.domNode.setSelectionRange(newSelStart, newSelEnd);
	} catch(e) {}

	this.syncCursorFromDOM();
	this.recordUndo(true);

	this.runHooks("afterOperation", null, opArray);

	this.widget.saveChanges(newText);
	this.fixHeight();

	return newText;
};

SimpleEngine.prototype.insertAtAllCursors = function(insertText) {
	if(insertText === undefined || insertText === null) return;
	insertText = String(insertText);

	this.captureBeforeState();

	var text = this.domNode.value;
	var primary = this.getPrimaryCursor();
	var start = primary.start;
	var end = primary.end;

	var newText = text.substring(0, start) + insertText + text.substring(end);
	var newPos = start + insertText.length;

	this.domNode.value = newText;
	this.lastKnownText = newText;

	try {
		this.domNode.setSelectionRange(newPos, newPos);
	} catch(e) {}

	this.syncCursorFromDOM();
	this.recordUndo(true);
	this.widget.saveChanges(newText);
	this.fixHeight();
};

SimpleEngine.prototype.deleteAtAllCursors = function(forward) {
	this.captureBeforeState();

	var text = this.domNode.value;
	var primary = this.getPrimaryCursor();
	var start = primary.start;
	var end = primary.end;

	if(start === end) {
		if(forward) {
			if(end >= text.length) return;
			end++;
		} else {
			if(start <= 0) return;
			start--;
		}
	}

	var newText = text.substring(0, start) + text.substring(end);

	this.domNode.value = newText;
	this.lastKnownText = newText;

	try {
		this.domNode.setSelectionRange(start, start);
	} catch(e) {}

	this.syncCursorFromDOM();
	this.recordUndo(true);
	this.widget.saveChanges(newText);
	this.fixHeight();
};

// ==================== HELPER METHODS ====================

SimpleEngine.prototype.getLineInfo = function(position) {
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

SimpleEngine.prototype.getPositionForLineColumn = function(line, column) {
	var text = this.domNode.value || "";
	var lines = text.split("\n");
	line = Math.max(0, Math.min(line, lines.length - 1));

	var pos = 0;
	for(var i = 0; i < line; i++) pos += lines[i].length + 1;

	column = Math.max(0, Math.min(column, lines[line].length));
	return pos + column;
};

SimpleEngine.prototype.getWordBoundsAt = function(position) {
	var text = this.domNode.value || "";
	var start = position, end = position;

	while(start > 0 && /\w/.test(text[start - 1])) start--;
	while(end < text.length && /\w/.test(text[end])) end++;

	return { start: start, end: end, word: text.substring(start, end) };
};

// ==================== EVENT HANDLERS ====================

SimpleEngine.prototype.handleBeforeInputEvent = function(event) {
	if(this._destroyed) return;

	this.lastKnownText = this.domNode.value;
	this.lastKnownSelection = { start: this.domNode.selectionStart, end: this.domNode.selectionEnd };

	this.captureBeforeState();

	var hookResult = this.runHooks("beforeInput", event, { inputType: event.inputType, data: event.data });
	if(hookResult.prevented) {
		event.preventDefault();
		this.pendingBeforeState = null;
	}
};

SimpleEngine.prototype.handleInputEvent = function(event) {
	if(this._destroyed) return true;

	this.syncCursorFromDOM();
	this.lastKnownText = this.domNode.value;

	this.recordUndo(false);

	this.runHooks("afterInput", event, null);

	this.widget.saveChanges(this.getText());
	this.fixHeight();

	if(this.widget.editInputActions) {
		this.widget.invokeActionString(this.widget.editInputActions, this, event, {
			actionValue: this.getText()
		});
	}

	return true;
};

SimpleEngine.prototype.handleKeydownEvent = function(event) {
	if(this._destroyed) return false;

	this.lastKnownText = this.domNode.value;
	this.lastKnownSelection = { start: this.domNode.selectionStart, end: this.domNode.selectionEnd };

	if(event.key === "Backspace" || event.key === "Delete") {
		this.captureBeforeState();
	}

	var hookResult = this.runHooks("beforeKeydown", event, null);
	if(hookResult.prevented) {
		event.preventDefault();
		return true;
	}

	// Handle undo/redo
	if((event.ctrlKey || event.metaKey) && !event.altKey) {
		var k = String(event.key).toLowerCase();
		if(!event.shiftKey && k === "z") { event.preventDefault(); this.undo(); return true; }
		if((!event.shiftKey && k === "y") || (event.shiftKey && k === "z")) { event.preventDefault(); this.redo(); return true; }
	}

	this.runHooks("afterKeydown", event, null);

	return false;
};

SimpleEngine.prototype.handleKeypressEvent = function(event) {
	if(this._destroyed) return false;

	var hookResult = this.runHooks("beforeKeypress", event, null);
	if(hookResult.prevented) {
		event.preventDefault();
		return true;
	}

	this.runHooks("afterKeypress", event, null);
	return false;
};

SimpleEngine.prototype.handleClickEvent = function(event) {
	if(this._destroyed) return false;

	var hookResult = this.runHooks("beforeClick", event, {
		ctrlKey: !!(event && (event.ctrlKey || event.metaKey)),
		shiftKey: !!(event && event.shiftKey),
		altKey: !!(event && event.altKey)
	});
	if(hookResult.prevented) {
		event.preventDefault();
		return true;
	}

	this.syncCursorFromDOM();
	this.runHooks("afterClick", event, null);

	return true;
};

SimpleEngine.prototype.handleSelectEvent = function(event) {
	if(this._destroyed) return;
	this.syncCursorFromDOM();
	this.runHooks("selectionChange", event, null);
};

SimpleEngine.prototype.handleFocusEvent = function(event) {
	if(this._destroyed) return true;

	if(this.widget.editCancelPopups) {
		$tw.popup.cancel(0);
	}
	if(this.widget.editFocusPopup) {
		$tw.popup.triggerPopup({
			domNode: this.domNode,
			title: this.widget.editFocusPopup,
			wiki: this.widget.wiki,
			force: true
		});
	}

	this.runHooks("focus", event, null);
	return true;
};

SimpleEngine.prototype.handleBlurEvent = function(event) {
	if(this._destroyed) return;
	this.runHooks("blur", event, null);
};

// ==================== UTILITY METHODS ====================

SimpleEngine.prototype.fixHeight = function() {
	if((this.widget.editTag === "textarea") && !this.widget.editRows) {
		if(this.widget.editAutoHeight) {
			if(this.domNode && !this.domNode.isTiddlyWikiFakeDom) {
				$tw.utils.resizeTextAreaToFit(this.domNode, this.widget.editMinHeight);
			}
		} else {
			var fixedHeight = parseInt(this.widget.wiki.getTiddlerText(HEIGHT_VALUE_TITLE, "400px"), 10);
			fixedHeight = Math.max(fixedHeight, 20);
			this.domNode.style.height = fixedHeight + "px";
		}
	}
};

SimpleEngine.prototype.focus = function() {
	if(this.domNode.focus) {
		this.domNode.focus();
	}
	if(this.domNode.select) {
		$tw.utils.setSelectionByPosition(this.domNode, this.widget.editFocusSelectFromStart, this.widget.editFocusSelectFromEnd);
	}
};

// Refocus without changing selection (for after text operations)
SimpleEngine.prototype.refocus = function() {
	if(this.domNode && this.domNode.focus) this.domNode.focus();
};

SimpleEngine.prototype.saveChanges = function() {
	this.widget.saveChanges(this.getText());
};

SimpleEngine.prototype.destroy = function() {
	if(this._destroyed) return;
	this._destroyed = true;

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
	this.undoStack = [];
	this.redoStack = [];
	this.pendingBeforeState = null;
};

// Stub methods for framed engine compatibility
SimpleEngine.prototype.getDocument = function() { return this.widget.document; };
SimpleEngine.prototype.getWindow = function() { return this.widget.document.defaultView || window; };
SimpleEngine.prototype.getWrapperNode = function() { return this.parentNode; };
SimpleEngine.prototype.getOverlayLayer = function() { return null; };
SimpleEngine.prototype.getDecorationLayer = function() { return null; };
SimpleEngine.prototype.getCursorLayer = function() { return null; };
SimpleEngine.prototype.getCoordinatesForPosition = function() { return null; };
SimpleEngine.prototype.getRectsForRange = function() { return []; };
SimpleEngine.prototype.clearDecorations = function() {};

exports.SimpleEngine = SimpleEngine;