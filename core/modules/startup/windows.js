/*\
title: $:/core/modules/startup/windows.js
type: application/javascript
module-type: startup

Setup root widget handlers for the messages concerned with opening external browser windows

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

// Export name and synchronous status
exports.name = "windows";
exports.platforms = ["browser"];
exports.after = ["startup"];
exports.synchronous = true;

// Global to keep track of open windows (hashmap by title)
$tw.windows = {};
// Default template to use for new windows
var DEFAULT_WINDOW_TEMPLATE = "$:/core/templates/single.tiddler.window";

exports.startup = function() {
	// Handle open window message
	$tw.rootWidget.addEventListener("tm-open-window",function(event) {
		// Get the parameters
		var refreshHandler,
			title = event.param || event.tiddlerTitle,
			paramObject = event.paramObject || {},
			windowTitle = paramObject.windowTitle || title,
			windowID = paramObject.windowID || title,
			template = paramObject.template || DEFAULT_WINDOW_TEMPLATE,
			width = paramObject.width || "700",
			height = paramObject.height || "600",
			top = paramObject.top,
			left = paramObject.left,
			variables = $tw.utils.extend({},paramObject,{currentTiddler: title, "tv-window-id": windowID});
		// Open the window
		var srcWindow,
			srcDocument;
		// In case that popup blockers deny opening a new window
		try {
			srcWindow = window.open("","external-" + windowID,"scrollbars,width=" + width + ",height=" + height + (top ? ",top=" + top : "" ) + (left ? ",left=" + left : "" )),
			srcDocument = srcWindow.document;
		}
		catch(e) {
			return;
		}
		$tw.windows[windowID] = srcWindow;
		// Check for reopening the same window
		if(srcWindow.haveInitialisedWindow) {
			srcWindow.focus();
			return;
		}
		// Initialise the document
		srcDocument.write("<html><head></head><body class='tc-body tc-single-tiddler-window'></body></html>");
		srcDocument.close();
		srcDocument.title = windowTitle;
		srcWindow.addEventListener("beforeunload",function(event) {
			delete $tw.windows[windowID];
			$tw.wiki.removeEventListener("change",refreshHandler);
		},false);
		// Set up the styles
		function setStylesheets() {
			for(var i=0; i<$tw.windows[windowID].stylesheetTiddlers.length; i++) {
				var stylesheetText = $tw.wiki.getTiddlerText($tw.stylesheetTiddlers[i]);
				$tw.utils.extend(variables,{ stylesheet: stylesheetText });
				var styleWidgetNode = $tw.wiki.makeTranscludeWidget("$:/core/ui/RootStylesheet",{
					document: $tw.fakeDocument,
					variables: variables,
					importPageMacros: true}),
					styleContainer = $tw.fakeDocument.createElement("style");
				$tw.windows[windowID].styleWidgetNodes.push(styleWidgetNode);
				$tw.windows[windowID].styleContainers.push(styleContainer);
				styleWidgetNode.render(styleContainer,null);
				var styleElement = srcDocument.createElement("style");
				$tw.windows[windowID].styleElements.push(styleElement);
				styleElement.innerHTML = styleContainer.textContent;
				srcDocument.head.insertBefore(styleElement,srcDocument.head.firstChild);
			}
		}

		function getStylesheets() {
			// Get our stylesheets in reversed order
			return $tw.wiki.filterTiddlers("[all[shadows+tiddlers]tag[$:/tags/Stylesheet]!has[draft.of]]").reverse();
		}

		$tw.windows[windowID].stylesheetTiddlers = getStylesheets();
		$tw.windows[windowID].excludedStylesheets = $tw.wiki.getTiddlersWithTag("$:/tags/Stylesheet/Static");
		$tw.windows[windowID].styleWidgetNodes = [];
		$tw.windows[windowID].styleContainers = [];
		$tw.windows[windowID].styleElements = [];
		setStylesheets();

		// Render the text of the tiddler
		var parser = $tw.wiki.parseTiddler(template),
			widgetNode = $tw.wiki.makeWidget(parser,{document: srcDocument, parentWidget: $tw.rootWidget, variables: variables});
		widgetNode.render(srcDocument.body,srcDocument.body.firstChild);
		// Function to handle refreshes
		refreshHandler = function(changes) {
			var stylesheetTiddlers = getStylesheets();
			$tw.windows[windowID].excludedStylesheets = $tw.wiki.getTiddlersWithTag("$:/tags/Stylesheet/Static");
			if(!$tw.utils.arraysEqual(stylesheetTiddlers,$tw.windows[windowID].stylesheetTiddlers) || $tw.utils.hopArray(changes,stylesheetTiddlers)) {
				for(var i=0; i<$tw.windows[windowID].stylesheetTiddlers.length; i++) {
					srcDocument.head.removeChild($tw.windows[windowID].styleElements[i]);
				}
				$tw.windows[windowID].stylesheetTiddlers = stylesheetTiddlers;
				$tw.windows[windowID].styleWidgetNodes = [];
				$tw.windows[windowID].styleContainers = [];
				$tw.windows[windowID].styleElements = [];
				setStylesheets();
			}
			for(var i=0; i<$tw.windows[windowID].stylesheetTiddlers.length; i++) {
				if($tw.windows[windowID].excludedStylesheets.indexOf($tw.windows[windowID].stylesheetTiddlers[i]) === -1) {
					if($tw.windows[windowID].styleWidgetNodes[i].refresh(changes,$tw.windows[windowID].styleContainers[i],null)) {
						var newStyles = $tw.windows[windowID].styleContainers[i].textContent;
						if(newStyles !== $tw.windows[windowID].styleWidgetNodes[i].assignedStyles) {
							$tw.windows[windowID].styleWidgetNodes[i].assignedStyles = newStyles;
							$tw.windows[windowID].styleElements[i].innerHTML = $tw.windows[windowID].styleWidgetNodes[i].assignedStyles;
						}
					}
				}
			}
			widgetNode.refresh(changes);
		};
		$tw.wiki.addEventListener("change",refreshHandler);
		// Listen for keyboard shortcuts
		$tw.utils.addEventListeners(srcDocument,[{
			name: "keydown",
			handlerObject: $tw.keyboardManager,
			handlerMethod: "handleKeydownEvent"
		}]);
		srcWindow.document.documentElement.addEventListener("click",$tw.popup,true);
		srcWindow.haveInitialisedWindow = true;
	});
	$tw.rootWidget.addEventListener("tm-close-window",function(event) {
		var windowID = event.param,
			win = $tw.windows[windowID];
			if(win) {
				win.close();
			}
	});
	var closeAllWindows = function() {
		$tw.utils.each($tw.windows,function(win) {
			win.close();
		});
	}
	$tw.rootWidget.addEventListener("tm-close-all-windows",closeAllWindows);
	// Close open windows when unloading main window
	$tw.addUnloadTask(closeAllWindows);
};

})();
