/*\
title: $:/core/modules/editor/factory.js
type: application/javascript
module-type: library

Factory for constructing text editor widgets with specified engines for the toolbar and non-toolbar cases.
Extended with dynamic plugin configuration and comprehensive message handlers for toolbar buttons.

\*/

"use strict";

var DEFAULT_MIN_TEXT_AREA_HEIGHT = "100px";

// Core configuration tiddlers
var HEIGHT_MODE_TITLE = "$:/config/TextEditor/EditorHeight/Mode";
var HEIGHT_VALUE_TITLE = "$:/config/TextEditor/EditorHeight/Height";
var ENABLE_TOOLBAR_TITLE = "$:/config/TextEditor/EnableToolbar";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

function editTextWidgetFactory(toolbarEngine,nonToolbarEngine) {

	var EditTextWidget = function(parseTreeNode,options) {
		if(!this.editorOperations) {
			EditTextWidget.prototype.editorOperations = {};
			$tw.modules.applyMethods("texteditoroperation",this.editorOperations);
		}
		this.initialise(parseTreeNode,options);
	};

	EditTextWidget.prototype = new Widget();

	// --- helpers -------------------------------------------------------

	EditTextWidget.prototype._isYes = function(value) {
		return value === "yes" || value === "true";
	};

	EditTextWidget.prototype._getConfigTextAny = function(titles, defValue) {
		for(var i = 0; i < titles.length; i++) {
			var t = titles[i];
			var v = this.wiki.getTiddlerText(t);
			if(v !== undefined && v !== null && v !== "") return v;
		}
		return defValue;
	};

	EditTextWidget.prototype._getBoolFromTiddlers = function(configTitles, defYesNo) {
		var v = this._getConfigTextAny(configTitles, defYesNo);
		return this._isYes(v) ? "yes" : "no";
	};

	EditTextWidget.prototype._safeGetPlugin = function(name) {
		if(this.engine && this.engine.getPlugin) return this.engine.getPlugin(name);
		return null;
	};

	// --- render --------------------------------------------------------

	EditTextWidget.prototype.render = function(parent,nextSibling) {
		this.parentDomNode = parent;
		this.computeAttributes();
		this.execute();

		if(this.editShowToolbar) {
			this.toolbarNode = this.document.createElement("div");
			this.toolbarNode.className = "tc-editor-toolbar";
			parent.insertBefore(this.toolbarNode,nextSibling);
			this.renderChildren(this.toolbarNode,null);
			this.domNodes.push(this.toolbarNode);
		}

		var editInfo = this.getEditInfo(),
			Engine = this.editShowToolbar ? toolbarEngine : nonToolbarEngine;

		this.engine = new Engine({
			widget: this,
			value: editInfo.value,
			type: editInfo.type,
			parentNode: parent,
			nextSibling: nextSibling
		});

		// Enable plugins based on configuration (after engine is created)
		this.enablePluginsFromConfig();

		// Configure plugins with detailed options
		this.configurePlugins();

		if(this.postRender) this.postRender();

		this.engine.fixHeight();

		if($tw.browser &&
			(this.editFocus === "true" || this.editFocus === "yes") &&
			!$tw.utils.hasClass(this.parentDomNode.ownerDocument.activeElement,"tc-keep-focus")) {
			this.engine.focus();
		}

		this.addEventListeners([
			// Core operations
			{type: "tm-edit-text-operation", handler: "handleEditTextOperationMessage"},
			{type: "tm-editor-undo", handler: "handleUndoMessage"},
			{type: "tm-editor-redo", handler: "handleRedoMessage"},
			
			// Plugin toggles
			{type: "tm-editor-toggle-vim", handler: "handleToggleVimMessage"},
			{type: "tm-editor-toggle-preview", handler: "handleTogglePreviewMessage"},
			{type: "tm-editor-toggle-search", handler: "handleToggleSearchMessage"},
			{type: "tm-editor-toggle-smart-pairs", handler: "handleToggleSmartPairsMessage"},
			{type: "tm-editor-toggle-line-numbers", handler: "handleToggleLineNumbersMessage"},
			{type: "tm-editor-toggle-autocomplete", handler: "handleToggleAutocompleteMessage"},
			{type: "tm-editor-toggle-diagnostics", handler: "handleToggleDiagnosticsMessage"},
			{type: "tm-editor-command-palette", handler: "handleCommandPaletteMessage"},
			
			// Search
			{type: "tm-editor-find", handler: "handleFindMessage"},
			{type: "tm-editor-find-next", handler: "handleFindNextMessage"},
			{type: "tm-editor-find-previous", handler: "handleFindPreviousMessage"},
			{type: "tm-editor-find-replace", handler: "handleFindReplaceMessage"},
			
			// Folding
			{type: "tm-editor-fold-section", handler: "handleFoldSectionMessage"},
			{type: "tm-editor-unfold-section", handler: "handleUnfoldSectionMessage"},
			{type: "tm-editor-fold-all", handler: "handleFoldAllMessage"},
			{type: "tm-editor-unfold-all", handler: "handleUnfoldAllMessage"},
			
			// Line operations
			{type: "tm-editor-duplicate-line", handler: "handleDuplicateLineMessage"},
			{type: "tm-editor-delete-line", handler: "handleDeleteLineMessage"},
			{type: "tm-editor-move-line-up", handler: "handleMoveLineUpMessage"},
			{type: "tm-editor-move-line-down", handler: "handleMoveLineDownMessage"},
			
			// Multi-cursor
			{type: "tm-editor-select-next-occurrence", handler: "handleSelectNextOccurrenceMessage"},
			{type: "tm-editor-select-all-occurrences", handler: "handleSelectAllOccurrencesMessage"},
			{type: "tm-editor-add-cursor-above", handler: "handleAddCursorAboveMessage"},
			{type: "tm-editor-add-cursor-below", handler: "handleAddCursorBelowMessage"},
			
			// Navigation
			{type: "tm-editor-goto-line", handler: "handleGotoLineMessage"},
			{type: "tm-editor-goto-symbol", handler: "handleGotoSymbolMessage"},
			{type: "tm-editor-jump-to-bracket", handler: "handleJumpToBracketMessage"},
			
			// Registers
			{type: "tm-editor-open-registers", handler: "handleOpenRegistersMessage"},
			{type: "tm-editor-copy-to-register", handler: "handleCopyToRegisterMessage"},
			{type: "tm-editor-paste-from-register", handler: "handlePasteFromRegisterMessage"},
			
			// History
			{type: "tm-editor-open-history", handler: "handleOpenHistoryMessage"},
			
			// Structural selection
			{type: "tm-editor-expand-selection", handler: "handleExpandSelectionMessage"},
			{type: "tm-editor-shrink-selection", handler: "handleShrinkSelectionMessage"},
			
			// Smart indent
			{type: "tm-editor-indent", handler: "handleIndentMessage"},
			{type: "tm-editor-outdent", handler: "handleOutdentMessage"}
		]);
	};

	/**
	 * Read plugin enable/disable config and apply it.
	 * Uses plugin metadata to find config tiddlers.
	 */
	EditTextWidget.prototype.enablePluginsFromConfig = function() {
		if(!this.engine || !this.engine.enablePluginsByConfig) return;

		var pluginMeta = this.engine.getPluginMetadata();
		var enabledMap = {};

		for(var name in pluginMeta) {
			var meta = pluginMeta[name];
			var attrName = "enable" + this._capitalizeFirst(name).replace(/-([a-z])/g, function(m, c) { return c.toUpperCase(); });
			var attrValue = this.getAttribute(attrName);

			var configTitles = [];
			if(meta.configTiddler) configTitles.push(meta.configTiddler);
			if(meta.configTiddlerAlt) configTitles.push(meta.configTiddlerAlt);

			var defaultValue = meta.defaultEnabled ? "yes" : "no";

			if(attrValue !== undefined) {
				// Attribute overrides config
				enabledMap[name] = this._isYes(attrValue) ? "yes" : "no";
			} else if(configTitles.length > 0) {
				// Use config tiddler
				enabledMap[name] = this._getBoolFromTiddlers(configTitles, defaultValue);
			} else {
				// Use default
				enabledMap[name] = defaultValue;
			}
		}

		this.engine.enablePluginsByConfig(enabledMap);
	};

	/**
	 * Capitalize first letter of a string
	 */
	EditTextWidget.prototype._capitalizeFirst = function(s) {
		if(!s) return s;
		return s.charAt(0).toUpperCase() + s.slice(1);
	};

	/**
	 * Configure plugins with detailed options (if plugin supports configure()).
	 */
	EditTextWidget.prototype.configurePlugins = function() {
		if(!this.engine) return;

		// Smart-pairs configuration
		this.engine.configurePlugin("smart-pairs", {
			enableBrackets: this.getAttribute("smartPairsBrackets") !== "no",
			enableQuotes: this.getAttribute("smartPairsQuotes") !== "no",
			enableWikitext: this.getAttribute("smartPairsWikitext") !== "no",
			deletePairs: this.getAttribute("smartPairsDeletePairs") !== "no"
		});

		// Folding configuration
		this.engine.configurePlugin("folding", {
			enabledByDefault: this.getAttribute("foldingDefault") === "yes",
			minFoldLines: $tw.utils.parseNumber(this.getAttribute("foldingMinLines") || "3"),
			foldMarker: this.getAttribute("foldingMarker") || "…"
		});
	};

	// --- edit info -----------------------------------------------------

	EditTextWidget.prototype.getEditInfo = function() {
		var self = this,
			value,
			type = "text/plain",
			update;

		if(this.editIndex) {
			value = this.wiki.extractTiddlerDataItem(this.editTitle,this.editIndex,this.editDefault);
			update = function(value) {
				var data = self.wiki.getTiddlerData(self.editTitle,{});
				if(data[self.editIndex] !== value) {
					data[self.editIndex] = value;
					self.wiki.setTiddlerData(self.editTitle,data);
				}
			};
		} else {
			var tiddler = this.wiki.getTiddler(this.editTitle);
			if(tiddler) {
				if(tiddler.hasField(this.editField)) value = tiddler.getFieldString(this.editField);
				else value = this.editDefault || "";
				if(this.editField === "text") type = tiddler.fields.type || "text/vnd.tiddlywiki";
			} else {
				switch(this.editField) {
					case "text": value = ""; type = "text/vnd.tiddlywiki"; break;
					case "title": value = this.editTitle; break;
					default: value = ""; break;
				}
				if(this.editDefault !== undefined) value = this.editDefault;
			}
			update = function(value) {
				var tiddler = self.wiki.getTiddler(self.editTitle),
					updateFields = { title: self.editTitle };
				updateFields[self.editField] = value;
				self.wiki.addTiddler(new $tw.Tiddler(
					self.wiki.getCreationFields(),
					tiddler,
					updateFields,
					self.wiki.getModificationFields()
				));
			};
		}

		if(this.editType) type = this.editType;
		return {value: value || "", type: type, update: update};
	};

	// --- messages: core ------------------------------------------------

	EditTextWidget.prototype.handleEditTextOperationMessage = function(event) {
		var operation = this.engine.createTextOperation();
		var handler = this.editorOperations[event.param];
		if(handler) handler.call(this,event,operation);
		var newText = this.engine.executeTextOperation(operation);
		this.engine.fixHeight();
		this.saveChanges(newText);
		// Refocus editor after toolbar button clicks (without changing selection)
		if(this.engine.refocus) this.engine.refocus();
	};

	EditTextWidget.prototype.handleUndoMessage = function(event) {
		if(this.engine.undo) this.engine.undo();
		return false;
	};

	EditTextWidget.prototype.handleRedoMessage = function(event) {
		if(this.engine.redo) this.engine.redo();
		return false;
	};

	// --- messages: plugin toggles --------------------------------------

	EditTextWidget.prototype.handleToggleVimMessage = function(event) {
		var vim = this._safeGetPlugin("vim-mode");
		if(vim) (vim.enabled ? vim.disable() : vim.enable());
		return false;
	};

	EditTextWidget.prototype.handleTogglePreviewMessage = function(event) {
		var preview = this._safeGetPlugin("inline-preview");
		if(preview) (preview.active ? preview.deactivate() : preview.activate());
		return false;
	};

	EditTextWidget.prototype.handleToggleSearchMessage = function(event) {
		var search = this._safeGetPlugin("search-enhanced");
		if(!search) search = this._safeGetPlugin("search");
		if(search && search.toggle) search.toggle();
		else if(search && search.open) search.open();
		return false;
	};

	EditTextWidget.prototype.handleToggleSmartPairsMessage = function(event) {
		var sp = this._safeGetPlugin("smart-pairs");
		if(sp) (sp.enabled ? sp.disable() : sp.enable());
		return false;
	};

	EditTextWidget.prototype.handleToggleLineNumbersMessage = function(event) {
		var ln = this._safeGetPlugin("line-numbers");
		if(ln) (ln.enabled ? ln.disable() : ln.enable());
		return false;
	};

	EditTextWidget.prototype.handleToggleAutocompleteMessage = function(event) {
		var ac = this._safeGetPlugin("autocomplete");
		if(ac) (ac.enabled ? ac.disable() : ac.enable());
		return false;
	};

	EditTextWidget.prototype.handleToggleDiagnosticsMessage = function(event) {
		var diag = this._safeGetPlugin("diagnostics");
		if(diag) (diag.enabled ? diag.disable() : diag.enable());
		return false;
	};

	EditTextWidget.prototype.handleCommandPaletteMessage = function(event) {
		var pal = this._safeGetPlugin("command-palette");
		if(pal && pal.open) pal.open();
		return false;
	};

	// --- messages: search ----------------------------------------------

	EditTextWidget.prototype.handleFindMessage = function(event) {
		var search = this._safeGetPlugin("search-enhanced");
		if(!search) search = this._safeGetPlugin("search");
		if(search && search.open) search.open();
		return false;
	};

	EditTextWidget.prototype.handleFindNextMessage = function(event) {
		var search = this._safeGetPlugin("search-enhanced");
		if(!search) search = this._safeGetPlugin("search");
		if(search && search.findNext) search.findNext();
		return false;
	};

	EditTextWidget.prototype.handleFindPreviousMessage = function(event) {
		var search = this._safeGetPlugin("search-enhanced");
		if(!search) search = this._safeGetPlugin("search");
		if(search && search.findPrevious) search.findPrevious();
		return false;
	};

	EditTextWidget.prototype.handleFindReplaceMessage = function(event) {
		var search = this._safeGetPlugin("search-enhanced");
		if(!search) search = this._safeGetPlugin("search");
		if(search && search.openReplace) search.openReplace();
		else if(search && search.open) search.open();
		return false;
	};

	// --- messages: folding ---------------------------------------------

	EditTextWidget.prototype.handleFoldSectionMessage = function(event) {
		var folding = this._safeGetPlugin("folding");
		if(folding && folding.foldCurrentSection) folding.foldCurrentSection(true);
		return false;
	};

	EditTextWidget.prototype.handleUnfoldSectionMessage = function(event) {
		var folding = this._safeGetPlugin("folding");
		if(folding && folding.foldCurrentSection) folding.foldCurrentSection(false);
		return false;
	};

	EditTextWidget.prototype.handleFoldAllMessage = function(event) {
		var folding = this._safeGetPlugin("folding");
		if(folding && folding.foldAll) folding.foldAll();
		return false;
	};

	EditTextWidget.prototype.handleUnfoldAllMessage = function(event) {
		var folding = this._safeGetPlugin("folding");
		if(folding && folding.unfoldAll) folding.unfoldAll();
		return false;
	};

	// --- messages: line operations -------------------------------------

	EditTextWidget.prototype.handleDuplicateLineMessage = function(event) {
		var lineBlock = this._safeGetPlugin("line-block");
		if(lineBlock && lineBlock.duplicateSelectionOrLines) lineBlock.duplicateSelectionOrLines();
		return false;
	};

	EditTextWidget.prototype.handleDeleteLineMessage = function(event) {
		var lineBlock = this._safeGetPlugin("line-block");
		if(lineBlock && lineBlock.deleteSelectionOrLines) lineBlock.deleteSelectionOrLines();
		return false;
	};

	EditTextWidget.prototype.handleMoveLineUpMessage = function(event) {
		var lineBlock = this._safeGetPlugin("line-block");
		if(lineBlock && lineBlock.moveSelectionOrLines) lineBlock.moveSelectionOrLines(-1);
		return false;
	};

	EditTextWidget.prototype.handleMoveLineDownMessage = function(event) {
		var lineBlock = this._safeGetPlugin("line-block");
		if(lineBlock && lineBlock.moveSelectionOrLines) lineBlock.moveSelectionOrLines(1);
		return false;
	};

	// --- messages: multi-cursor ----------------------------------------

	EditTextWidget.prototype.handleSelectNextOccurrenceMessage = function(event) {
		var mc = this._safeGetPlugin("multi-cursor");
		if(mc && mc.selectNextOccurrence) mc.selectNextOccurrence();
		return false;
	};

	EditTextWidget.prototype.handleSelectAllOccurrencesMessage = function(event) {
		var mc = this._safeGetPlugin("multi-cursor");
		if(mc && mc.selectAllOccurrences) mc.selectAllOccurrences();
		return false;
	};

	EditTextWidget.prototype.handleAddCursorAboveMessage = function(event) {
		var mc = this._safeGetPlugin("multi-cursor");
		if(mc && mc.addCursorInDirection) mc.addCursorInDirection(-1);
		return false;
	};

	EditTextWidget.prototype.handleAddCursorBelowMessage = function(event) {
		var mc = this._safeGetPlugin("multi-cursor");
		if(mc && mc.addCursorInDirection) mc.addCursorInDirection(1);
		return false;
	};

	// --- messages: navigation ------------------------------------------

	EditTextWidget.prototype.handleGotoLineMessage = function(event) {
		var jump = this._safeGetPlugin("jump-navigation");
		if(jump && jump.openGotoLine) jump.openGotoLine();
		return false;
	};

	EditTextWidget.prototype.handleGotoSymbolMessage = function(event) {
		var jump = this._safeGetPlugin("jump-navigation");
		if(jump && jump.openGotoSymbol) jump.openGotoSymbol();
		return false;
	};

	EditTextWidget.prototype.handleJumpToBracketMessage = function(event) {
		var jump = this._safeGetPlugin("jump-navigation");
		if(jump && jump.jumpToMatch) jump.jumpToMatch();
		return false;
	};

	// --- messages: registers -------------------------------------------

	EditTextWidget.prototype.handleOpenRegistersMessage = function(event) {
		var reg = this._safeGetPlugin("registers");
		if(reg && reg.openPanel) reg.openPanel();
		return false;
	};

	EditTextWidget.prototype.handleCopyToRegisterMessage = function(event) {
		var reg = this._safeGetPlugin("registers");
		if(reg && reg.copyToRegister) reg.copyToRegister();
		return false;
	};

	EditTextWidget.prototype.handlePasteFromRegisterMessage = function(event) {
		var reg = this._safeGetPlugin("registers");
		if(reg && reg.pasteFromRegister) reg.pasteFromRegister();
		return false;
	};

	// --- messages: history ---------------------------------------------

	EditTextWidget.prototype.handleOpenHistoryMessage = function(event) {
		var hist = this._safeGetPlugin("edit-history");
		if(hist && hist.openPicker) hist.openPicker();
		return false;
	};

	// --- messages: structural selection --------------------------------

	EditTextWidget.prototype.handleExpandSelectionMessage = function(event) {
		var ss = this._safeGetPlugin("structural-selection");
		if(ss && ss.expand) ss.expand();
		return false;
	};

	EditTextWidget.prototype.handleShrinkSelectionMessage = function(event) {
		var ss = this._safeGetPlugin("structural-selection");
		if(ss && ss.shrink) ss.shrink();
		return false;
	};

	// --- messages: smart indent ----------------------------------------

	EditTextWidget.prototype.handleIndentMessage = function(event) {
		var si = this._safeGetPlugin("smart-indent");
		if(si && si.indentSelection) si.indentSelection();
		return false;
	};

	EditTextWidget.prototype.handleOutdentMessage = function(event) {
		var si = this._safeGetPlugin("smart-indent");
		if(si && si.outdent) si.outdent();
		return false;
	};

	// --- execute (attributes) -----------------------------------------

	EditTextWidget.prototype.execute = function() {
		// Base
		this.editTitle = this.getAttribute("tiddler",this.getVariable("currentTiddler"));
		this.editField = this.getAttribute("field","text");
		this.editIndex = this.getAttribute("index");
		this.editDefault = this.getAttribute("default");
		this.editClass = this.getAttribute("class");
		this.editPlaceholder = this.getAttribute("placeholder");
		this.editSize = this.getAttribute("size");
		this.editRows = this.getAttribute("rows");

		// Height behavior
		var heightMode = this.wiki.getTiddlerText(HEIGHT_MODE_TITLE,"auto");
		this.editAutoHeight = this._isYes(this.getAttribute("autoHeight", heightMode === "auto" ? "yes" : "no")) ? true : false;
		this.editMinHeight = this.getAttribute("minHeight",DEFAULT_MIN_TEXT_AREA_HEIGHT);

		// Focus/UX
		this.editFocusPopup = this.getAttribute("focusPopup");
		this.editFocus = this.getAttribute("focus");
		this.editFocusSelectFromStart = $tw.utils.parseNumber(this.getAttribute("focusSelectFromStart","0"));
		this.editFocusSelectFromEnd = $tw.utils.parseNumber(this.getAttribute("focusSelectFromEnd","0"));
		this.editTabIndex = this.getAttribute("tabindex");
		this.editCancelPopups = this._isYes(this.getAttribute("cancelPopups","no")) ? true : false;

		// Actions
		this.editInputActions = this.getAttribute("inputActions");
		this.editRefreshTitle = this.getAttribute("refreshTitle");

		// Browser input attributes (pass-through; engine decides what to do)
		this.editAutoComplete = this.getAttribute("autocomplete");
		this.editSpellcheck = this.getAttribute("spellcheck");            // yes/no
		this.editWrap = this.getAttribute("wrap");                        // soft/hard/off
		this.editAutoCorrect = this.getAttribute("autocorrect");          // on/off
		this.editAutoCapitalize = this.getAttribute("autocapitalize");    // on/off/sentences/words/characters
		this.editInputMode = this.getAttribute("inputmode");              // text/search/email/...
		this.editEnterKeyHint = this.getAttribute("enterkeyhint");        // done/go/next/search/send
		this.editName = this.getAttribute("name");
		this.editDir = this.getAttribute("dir");                          // auto/ltr/rtl
		this.editLang = this.getAttribute("lang");
		this.editAriaLabel = this.getAttribute("ariaLabel");
		this.editAriaDescription = this.getAttribute("ariaDescription");
		this.editReadOnly = this.getAttribute("readonly","no");           // yes/no

		// Disabled / filedrop
		this.isDisabled = this.getAttribute("disabled","no");
		this.isFileDropEnabled = this._isYes(this.getAttribute("fileDrop","no"));

		// Determine default edit tag/type
		var tag,type;
		if(this.editField === "text") {
			tag = "textarea";
		} else {
			tag = "input";
			var fieldModule = $tw.Tiddler.fieldModules[this.editField];
			if(fieldModule && fieldModule.editTag) tag = fieldModule.editTag;
			if(fieldModule && fieldModule.editType) type = fieldModule.editType;
			type = type || "text";
		}
		this.editTag = this.getAttribute("tag",tag) || "input";
		this.editType = this.getAttribute("type",type);

		// Children (toolbar)
		this.makeChildWidgets();

		// Toolbar visibility
		this.editShowToolbar = this.wiki.getTiddlerText(ENABLE_TOOLBAR_TITLE,"yes");
		this.editShowToolbar = (this.editShowToolbar === "yes") &&
			!!(this.children && this.children.length > 0) &&
			(!this.document.isTiddlyWikiFakeDom);
	};

	// --- refresh -------------------------------------------------------

	/**
	 * Build list of config tiddlers to watch for refresh.
	 * Includes core config + all plugin config tiddlers.
	 */
	EditTextWidget.prototype._getRefreshTiddlers = function() {
		var tiddlers = [
			HEIGHT_MODE_TITLE,
			HEIGHT_VALUE_TITLE,
			ENABLE_TOOLBAR_TITLE,
			"$:/palette"
		];

		// Add plugin config tiddlers if engine exists
		if(this.engine && this.engine.getPluginConfigTiddlers) {
			var pluginTiddlers = this.engine.getPluginConfigTiddlers();
			tiddlers = tiddlers.concat(pluginTiddlers);
		}

		return tiddlers;
	};

	EditTextWidget.prototype.refresh = function(changedTiddlers) {
		var changedAttributes = this.computeAttributes();

		// Check for attribute changes that require full refresh
		if(changedAttributes.tiddler ||
			changedAttributes.field ||
			changedAttributes.index ||
			changedAttributes["default"] ||
			changedAttributes["class"] ||
			changedAttributes.placeholder ||
			changedAttributes.size ||
			changedAttributes.autoHeight ||
			changedAttributes.minHeight ||
			changedAttributes.focusPopup ||
			changedAttributes.rows ||
			changedAttributes.tabindex ||
			changedAttributes.cancelPopups ||
			changedAttributes.inputActions ||
			changedAttributes.refreshTitle ||
			changedAttributes.autocomplete ||
			changedAttributes.disabled ||
			changedAttributes.fileDrop ||
			changedAttributes.tag ||
			changedAttributes.type ||
			changedAttributes.spellcheck ||
			changedAttributes.wrap ||
			changedAttributes.autocorrect ||
			changedAttributes.autocapitalize ||
			changedAttributes.inputmode ||
			changedAttributes.enterkeyhint ||
			changedAttributes.name ||
			changedAttributes.dir ||
			changedAttributes.lang ||
			changedAttributes.ariaLabel ||
			changedAttributes.ariaDescription ||
			changedAttributes.readonly) {
			this.refreshSelf();
			return true;
		}

		// Check if any plugin enable attribute changed
		var pluginEnableAttrsChanged = this._checkPluginEnableAttributesChanged(changedAttributes);
		if(pluginEnableAttrsChanged) {
			this.refreshSelf();
			return true;
		}

		// Check if any watched config tiddlers changed
		var refreshTiddlers = this._getRefreshTiddlers();
		for(var i = 0; i < refreshTiddlers.length; i++) {
			if(changedTiddlers[refreshTiddlers[i]]) {
				this.refreshSelf();
				return true;
			}
		}

		// Handle content updates without full refresh
		if(changedTiddlers[this.editRefreshTitle]) {
			this.engine.updateDomNodeText(this.getEditInfo().value);
		} else if(changedTiddlers[this.editTitle]) {
			var editInfo = this.getEditInfo();
			this.updateEditor(editInfo.value,editInfo.type);
		}

		this.engine.fixHeight();
		return this.editShowToolbar ? this.refreshChildren(changedTiddlers) : false;
	};

	/**
	 * Check if any plugin enable/disable attributes changed.
	 */
	EditTextWidget.prototype._checkPluginEnableAttributesChanged = function(changedAttributes) {
		if(!this.engine || !this.engine.getPluginMetadata) return false;

		var pluginMeta = this.engine.getPluginMetadata();
		for(var name in pluginMeta) {
			// Convert plugin name to attribute name (e.g., "smart-pairs" -> "enableSmartPairs")
			var attrName = "enable" + this._capitalizeFirst(name).replace(/-([a-z])/g, function(m, c) { return c.toUpperCase(); });
			if(changedAttributes[attrName]) {
				return true;
			}
		}
		return false;
	};

	// --- cleanup -------------------------------------------------------

	EditTextWidget.prototype.removeChildDomNodes = function() {
		if(this.engine && this.engine.destroy) this.engine.destroy();
		Widget.prototype.removeChildDomNodes.call(this);
	};

	// --- update/save ---------------------------------------------------

	EditTextWidget.prototype.updateEditor = function(text,type) { this.updateEditorDomNode(text,type); };
	EditTextWidget.prototype.updateEditorDomNode = function(text,type) { this.engine.setText(text,type); };

	EditTextWidget.prototype.saveChanges = function(text) {
		var editInfo = this.getEditInfo();
		if(text !== editInfo.value) editInfo.update(text);
	};

	// --- key propagation (unchanged) ----------------------------------

	EditTextWidget.prototype.handleKeydownEvent = function(event) {
		if(this.toolbarNode) {
			var shortcutElements = this.toolbarNode.querySelectorAll("[data-tw-keyboard-shortcut]");
			for(var index=0; index<shortcutElements.length; index++) {
				var el = shortcutElements[index],
					shortcutData = el.getAttribute("data-tw-keyboard-shortcut"),
					keyInfoArray = $tw.keyboardManager.parseKeyDescriptors(shortcutData,{ wiki: this.wiki });
				if($tw.keyboardManager.checkKeyDescriptors(event,keyInfoArray)) {
					var clickEvent = this.document.createEvent("Events");
					clickEvent.initEvent("click",true,false);
					el.dispatchEvent(clickEvent);
					event.preventDefault();
					event.stopPropagation();
					return true;
				}
			}
		}
		if(this.propogateKeydownEvent(event)) {
			event.preventDefault();
			event.stopPropagation();
			return true;
		}
		return false;
	};

	EditTextWidget.prototype.propogateKeydownEvent = function(event) {
		var newEvent = this.cloneEvent(event,["keyCode","code","which","key","metaKey","ctrlKey","altKey","shiftKey"]);
		return !this.parentDomNode.dispatchEvent(newEvent);
	};

	EditTextWidget.prototype.cloneEvent = function(event,propertiesToCopy) {
		propertiesToCopy = propertiesToCopy || [];
		var newEvent = this.document.createEventObject ?
			this.document.createEventObject() :
			this.document.createEvent("Events");
		if(newEvent.initEvent) newEvent.initEvent(event.type, true, true);
		$tw.utils.each(propertiesToCopy,function(prop){ newEvent[prop] = event[prop]; });
		return newEvent;
	};

	EditTextWidget.prototype.dispatchDOMEvent = function(newEvent) {
		var dispatchNode = this.engine.iframeNode || this.engine.parentNode;
		return dispatchNode.dispatchEvent(newEvent);
	};

	// --- file drop plumbing (unchanged) --------------------------------

	EditTextWidget.prototype.handleDropEvent = function(event) {
		if($tw.utils.dragEventContainsFiles(event)) {
			event.preventDefault();
			event.stopPropagation();
			this.dispatchDOMEvent(this.cloneEvent(event,["dataTransfer"]));
		}
	};

	EditTextWidget.prototype.handlePasteEvent = function(event) {
		if(event.clipboardData && event.clipboardData.files && event.clipboardData.files.length) {
			event.preventDefault();
			event.stopPropagation();
			this.dispatchDOMEvent(this.cloneEvent(event,["clipboardData"]));
		}
	};

	EditTextWidget.prototype.handleDragEnterEvent = function(event) {
		if($tw.utils.dragEventContainsFiles(event)) {
			if(event.relatedTarget && (event.relatedTarget.nodeType === 3 || event.target === event.relatedTarget)) {
				return true;
			}
			event.preventDefault();
			return this.dispatchDOMEvent(this.cloneEvent(event,["dataTransfer"]));
		}
		return true;
	};

	EditTextWidget.prototype.handleDragOverEvent = function(event) {
		if($tw.utils.dragEventContainsFiles(event)) {
			if($tw.browser.isFirefox || $tw.browser.isIE) event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
			return this.dispatchDOMEvent(this.cloneEvent(event,["dataTransfer"]));
		}
		return true;
	};

	EditTextWidget.prototype.handleDragLeaveEvent = function(event) {
		if(event.relatedTarget && ((event.relatedTarget.nodeType === 3) || (event.target === event.relatedTarget))) {
			return true;
		}
		event.preventDefault();
		this.dispatchDOMEvent(this.cloneEvent(event,["dataTransfer"]));
	};

	EditTextWidget.prototype.handleDragEndEvent = function(event) {
		this.dispatchDOMEvent(this.cloneEvent(event));
	};

	EditTextWidget.prototype.handleClickEvent = function(event) {
		return !this.dispatchDOMEvent(this.cloneEvent(event));
	};

	return EditTextWidget;
}

exports.editTextWidgetFactory = editTextWidgetFactory;