/*\
title: $:/core/modules/startup/render.js
type: application/javascript
module-type: startup

Title, stylesheet and page rendering

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

// Export name and synchronous status
exports.name = "render";
exports.platforms = ["browser"];
exports.after = ["story"];
exports.synchronous = true;

// Default story and history lists
var PAGE_TITLE_TITLE = "$:/core/wiki/title";
var PAGE_STYLESHEET_TITLE = "$:/core/ui/RootStylesheet";
var PAGE_TEMPLATE_TITLE = "$:/core/ui/RootTemplate";

// Time (in ms) that we defer refreshing changes to draft tiddlers
var DRAFT_TIDDLER_TIMEOUT_TITLE = "$:/config/Drafts/TypingTimeout";
var THROTTLE_REFRESH_TIMEOUT = 400;

exports.startup = function() {
	// Set up the title
	$tw.titleWidgetNode = $tw.wiki.makeTranscludeWidget(PAGE_TITLE_TITLE,{document: $tw.fakeDocument, parseAsInline: true});
	$tw.titleContainer = $tw.fakeDocument.createElement("div");
	$tw.titleWidgetNode.render($tw.titleContainer,null);
	document.title = $tw.titleContainer.textContent;
	$tw.wiki.addEventListener("change",function(changes) {
		if($tw.titleWidgetNode.refresh(changes,$tw.titleContainer,null)) {
			document.title = $tw.titleContainer.textContent;
		}
	});

	function getStyleWidgets(widget,array) {
		array = array || [];
		if(widget.parseTreeNode.type === "element" && widget.parseTreeNode.tag === "style") {
			array.push(widget.domNodes[0]);
		}
		for(var i=0; i<widget.children.length; i++) {
			getStyleWidgets(widget.children[i],array);
		}
		return array;
	}
	// Set up the styles
	$tw.styleWidgetNode = $tw.wiki.makeTranscludeWidget(PAGE_STYLESHEET_TITLE,{document: $tw.fakeDocument});
	$tw.styleContainer = $tw.fakeDocument.createElement("style");
	$tw.styleWidgetNode.render($tw.styleContainer,null);
	$tw.styleWidgets = getStyleWidgets($tw.styleWidgetNode);
	
	$tw.styleElements = [];
	var styleTags = document.head.getElementsByTagName("style"),
		lastStyleTag = styleTags[styleTags.length - 1],
		insertBeforeElement;
	if(lastStyleTag) {
		insertBeforeElement = lastStyleTag.nextSibling;
	} else {
		insertBeforeElement = document.head.firstChild;
	}
	var styleElement;
	if($tw.styleWidgets.length) {
		for(var i=0; i<$tw.styleWidgets.length; i++) {
			styleElement = document.createElement("style");
			styleElement.innerHTML = $tw.styleWidgets[i].textContent;
			$tw.styleElements.push(styleElement);
			document.head.insertBefore(styleElement,insertBeforeElement);
		}
	} else {
		styleElement = document.createElement("style");
		styleElement.innerHTML = $tw.styleContainer.textContent;
		$tw.styleElements.push(styleElement);
		document.head.insertBefore(styleElement,insertBeforeElement);
	}

	var styleWidgetRefreshHandler = function(changes) {
		if($tw.styleWidgetNode.refresh(changes,$tw.styleContainer,null)) {
			var styleWidgets = getStyleWidgets($tw.styleWidgetNode),
				newStyles,i;
			if(styleWidgets.length && styleWidgets !== $tw.styleWidgets) {
				for(i=0; i<styleWidgets.length; i++) {
					newStyles = styleWidgets[i].textContent;
					if(!$tw.styleElements[i]) {
						styleElement = document.createElement("style");
						document.head.insertBefore(styleElement,$tw.styleElements[i] || $tw.styleElements[i - 1].nextSibling);
						$tw.styleElements.splice(i,0,styleElement);
					}
					if(newStyles !== $tw.styleElements[i].textContent) {
						$tw.styleElements[i].innerHTML = newStyles;
					}
				}
				if(styleWidgets.length < $tw.styleElements.length) {
					var removedElements = [];
					for(i=0; i<$tw.styleWidgets.length; i++) {
						if($tw.styleElements[i] && styleWidgets.indexOf($tw.styleWidgets[i]) === -1) {
							document.head.removeChild($tw.styleElements[i]);
							removedElements.push(i);
						}
					}
					for(i=0; i<removedElements.length; i++) {
						var index = removedElements[i];
						$tw.styleElements.splice(index,1);
					}
				}
			} else if(styleWidgets.length === 0) {
				for(i=($tw.styleWidgets.length - 1); i>=1; i--) {
					if($tw.styleElements[i]) {
						document.head.removeChild($tw.styleElements[i]);
						$tw.styleElements.splice(i,1);
					}
				}
				newStyles = $tw.styleContainer.textContent;
				if(newStyles !== $tw.styleElements[0].textContent) {
					$tw.styleElements[0].innerHTML = newStyles;
				}
			}
			$tw.styleWidgets = styleWidgets;
		}
	};

	$tw.wiki.addEventListener("change",$tw.perf.report("styleRefresh",styleWidgetRefreshHandler));

	// Display the $:/core/ui/PageTemplate tiddler to kick off the display
	$tw.perf.report("mainRender",function() {
		$tw.pageWidgetNode = $tw.wiki.makeTranscludeWidget(PAGE_TEMPLATE_TITLE,{document: document, parentWidget: $tw.rootWidget, recursionMarker: "no"});
		$tw.pageContainer = document.createElement("div");
		$tw.utils.addClass($tw.pageContainer,"tc-page-container-wrapper");
		document.body.insertBefore($tw.pageContainer,document.body.firstChild);
		$tw.pageWidgetNode.render($tw.pageContainer,null);
   		$tw.hooks.invokeHook("th-page-refreshed");
	})();
	// Remove any splash screen elements
	var removeList = document.querySelectorAll(".tc-remove-when-wiki-loaded");
	$tw.utils.each(removeList,function(removeItem) {
		if(removeItem.parentNode) {
			removeItem.parentNode.removeChild(removeItem);
		}
	});
	// Prepare refresh mechanism
	var deferredChanges = Object.create(null),
		timerId;
	function refresh() {
		// Process the refresh
		$tw.hooks.invokeHook("th-page-refreshing");
		$tw.pageWidgetNode.refresh(deferredChanges);
		deferredChanges = Object.create(null);
		$tw.hooks.invokeHook("th-page-refreshed");
	}
	var throttledRefresh = $tw.perf.report("throttledRefresh",refresh);

	// Add the change event handler
	$tw.wiki.addEventListener("change",$tw.perf.report("mainRefresh",function(changes) {
		// Check if only tiddlers that are throttled have changed
		var onlyThrottledTiddlersHaveChanged = true;
		for(var title in changes) {
			var tiddler = $tw.wiki.getTiddler(title);
			if(!$tw.wiki.isVolatileTiddler(title) && (!tiddler || !(tiddler.hasField("draft.of") || tiddler.hasField("throttle.refresh")))) {
				onlyThrottledTiddlersHaveChanged = false;
			}
		}
		// Defer the change if only drafts have changed
		if(timerId) {
			clearTimeout(timerId);
		}
		timerId = null;
		if(onlyThrottledTiddlersHaveChanged) {
			var timeout = parseInt($tw.wiki.getTiddlerText(DRAFT_TIDDLER_TIMEOUT_TITLE,""),10);
			if(isNaN(timeout)) {
				timeout = THROTTLE_REFRESH_TIMEOUT;
			}
			timerId = setTimeout(throttledRefresh,timeout);
			$tw.utils.extend(deferredChanges,changes);
		} else {
			$tw.utils.extend(deferredChanges,changes);
			refresh();
		}
	}));
	// Fix up the link between the root widget and the page container
	$tw.rootWidget.domNodes = [$tw.pageContainer];
	$tw.rootWidget.children = [$tw.pageWidgetNode];
	// Run any post-render startup actions
	$tw.rootWidget.invokeActionsByTag("$:/tags/StartupAction/PostRender");
};

})();
