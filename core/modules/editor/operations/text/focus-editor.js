/*\
title: $:/core/modules/editor/operations/text/focus-editor.js
type: application/javascript
module-type: texteditoroperation

Simply focus the text editor without modifying content.
Supports multi-cursor format (no-op on all cursors).

\*/

"use strict";

exports["focus-editor"] = function(event, operation) {
	// Handle both array and single operation
	var ops = Array.isArray(operation) ? operation : [operation];
	
	// Mark all operations as no-op (no text changes)
	for(var i = 0; i < ops.length; i++) {
		if(ops[i]) {
			ops[i].replacement = null;
		}
	}
	
	// The actual focus happens via the engine after the operation completes
};