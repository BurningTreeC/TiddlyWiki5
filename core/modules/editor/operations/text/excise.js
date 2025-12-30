/*\
title: $:/core/modules/editor/operations/text/excise.js
type: application/javascript
module-type: texteditoroperation

Text editor operation to excise the selection to a new tiddler.
Supports multiple cursors/selections - each creates a separate tiddler.

\*/

"use strict";

function isMarkdown(mediaType) {
	return mediaType === "text/markdown" || mediaType === "text/x-markdown";
}

function getParams(event) {
	var p = (event && event.paramObject) ? event.paramObject : {};
	return {
		title: p.title || "",
		type: p.type || "transclude",
		tagnew: p.tagnew === "yes",
		macro: p.macro || "translink"
	};
}

function normalizeOp(op, sharedText) {
	op.text = (typeof op.text === "string") ? op.text : (sharedText || "");
	op.selStart = (op.selStart !== undefined && op.selStart !== null) ? op.selStart : 0;
	op.selEnd = (op.selEnd !== undefined && op.selEnd !== null) ? op.selEnd : op.selStart;
	if(op.selEnd < op.selStart) {
		var tmp = op.selStart;
		op.selStart = op.selEnd;
		op.selEnd = tmp;
	}
	op.selection = (typeof op.selection === "string") ? op.selection : op.text.substring(op.selStart, op.selEnd);
}

function buildReplacement(excisionTitle, type, macro, wikiLinks) {
	switch(type) {
		case "link":
			return wikiLinks 
				? "[[" + excisionTitle + "]]"
				: "[" + excisionTitle + "](<#" + excisionTitle + ">)";
		case "macro":
			return "<<" + macro + " \"\"\"" + excisionTitle + "\"\"\">>";
		case "transclude":
		default:
			return "{{" + excisionTitle + "}}";
	}
}

function processOperation(widget, op, params, sharedText, index) {
	normalizeOp(op, sharedText);
	
	// Skip empty selections
	if(op.selStart === op.selEnd || !op.selection) {
		op.replacement = null;
		return;
	}
	
	var wiki = widget.wiki;
	var editTiddler = wiki.getTiddler(widget.editTitle);
	var editTiddlerTitle = widget.editTitle;
	var wikiLinks = !isMarkdown(editTiddler ? editTiddler.fields.type : "");
	var excisionBaseTitle = $tw.language.getString("Buttons/Excise/DefaultTitle");
	
	// Get the source tiddler title (handle drafts)
	if(editTiddler && editTiddler.fields["draft.of"]) {
		editTiddlerTitle = editTiddler.fields["draft.of"];
	}
	
	// Generate unique title for each excision
	var excisionTitle;
	if(params.title && index === 0) {
		// Use provided title only for first excision
		excisionTitle = params.title;
	} else if(params.title && index > 0) {
		// Subsequent excisions get numbered suffix
		excisionTitle = wiki.generateNewTitle(params.title);
	} else {
		excisionTitle = wiki.generateNewTitle(excisionBaseTitle);
	}
	
	// Create the new tiddler with the selection
	wiki.addTiddler(new $tw.Tiddler(
		wiki.getCreationFields(),
		wiki.getModificationFields(),
		{
			title: excisionTitle,
			text: op.selection,
			tags: params.tagnew ? [editTiddlerTitle] : [],
			type: editTiddler ? editTiddler.fields.type : ""
		}
	));
	
	// Build the replacement reference
	op.replacement = buildReplacement(excisionTitle, params.type, params.macro, wikiLinks);
	op.cutStart = op.selStart;
	op.cutEnd = op.selEnd;
	op.newSelStart = op.selStart;
	op.newSelEnd = op.selStart + op.replacement.length;
}

exports["excise"] = function(event, operation) {
	var params = getParams(event);
	var widget = this;
	
	// Handle both array and single operation
	var ops = Array.isArray(operation) ? operation : [operation];
	
	// Get the text from the first operation
	var text = (ops[0] && ops[0].text) ? ops[0].text : "";
	
	// Track how many excisions we've done (for unique titles)
	var excisionIndex = 0;
	
	for(var i = 0; i < ops.length; i++) {
		if(ops[i] && typeof ops[i] === "object") {
			// Only increment index for non-empty selections
			var hasSelection = ops[i].selStart !== ops[i].selEnd;
			if(hasSelection || (ops[i].selection && ops[i].selection.length > 0)) {
				processOperation(widget, ops[i], params, text, excisionIndex);
				excisionIndex++;
			} else {
				ops[i].replacement = null;
			}
		}
	}
};