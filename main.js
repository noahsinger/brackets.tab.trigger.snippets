/*
 * Copyright (c) 2013 Jonathan Rowny. All rights reserved.
 * http://www.jonathanrowny.com
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, brackets, $, Mustache, window */

define(function (require, exports, module) {
    'use strict';
    var Commands                = brackets.getModule("command/Commands"),
        CommandManager          = brackets.getModule("command/CommandManager"),
        EditorManager           = brackets.getModule("editor/EditorManager"),
        DocumentManager         = brackets.getModule("document/DocumentManager"),
        ExtensionUtils          = brackets.getModule("utils/ExtensionUtils"),
        NativeFileSystem        = brackets.getModule("file/NativeFileSystem").NativeFileSystem,
        KeyBindingManager       = brackets.getModule("command/KeyBindingManager"),
        FileUtils               = brackets.getModule("file/FileUtils"),
        Menus                   = brackets.getModule("command/Menus"),
        PanelManager            = brackets.getModule("view/PanelManager");

    // Local modules
    var InlineSnippetForm = require("InlineSnippetForm"),
        SnippetPresets    = require("SnippetPresets"),
        panelHtml         = require("text!templates/bottom-panel.html"),
        snippetsHTML      = require("text!templates/snippets-table.html");
        
        //Snippets array
    var snippets = [],
        //directory where snippets are
        directory = "",
        $snippetsPanel,
        $snippetsContent,
        panel;
        
    //commands
    var SNIPPET_EXECUTE = "snippets.execute",
        VIEW_HIDE_SNIPPETS = "snippets.hideSnippets";
    
    function _handleHideSnippets() {
        if (panel.isVisible()) {
            panel.hide();
            CommandManager.get(VIEW_HIDE_SNIPPETS).setChecked(false);
        } else {
            panel.show();
            CommandManager.get(VIEW_HIDE_SNIPPETS).setChecked(true);
        }
        EditorManager.resizeEditor();
    }
    
    function inlineSnippetFormProvider(hostEditor, props, snippet) {
        var result = new $.Deferred();

        var snippetForm = new InlineSnippetForm(props, snippet);
        snippetForm.load(hostEditor);
        result.resolve(snippetForm);
        
        return result.promise();
    }
        
    function _handleSnippet(props) {
		console.log("_handleSnippet")
		console.log("\tpassed props: " + props);
        var editor = EditorManager.getCurrentFullEditor();
        var document = DocumentManager.getCurrentDocument();
        var pos = editor.getCursorPos();
        var line = document.getLine(pos.line);
        if (!props) {
            props = $.trim(line).split(" ");
			console.log("\tfound props: " + props);
        }
        
        function completeInsert(editor, output, start, end) {
			console.log("completeInsert")
			console.log("\teditor:" + editor + "\n\toutput: " + output);
            var s,
                x,
                linePos = -1,
				charPos,
                lines = output.split("\n");
				
            //figure out cursor pos, remove cursor marker
			console.log("\tinserting snippet and placing cursor");
            for (s = 0; s < lines.length; s++) {
                if (lines[s].indexOf('!!{cursor}') >= 0) {
					charPos = lines[s].indexOf('!!{cursor}');
					linePos = s;
					console.log("\t\tcursor placement needs to be at line " + linePos + " char " + charPos + " of the snippet");
                    output = output.replace('!!{cursor}', '');
                    break;
                }
            }

			pos = editor.getCursorPos();
			console.log("\t\tbefore insert cursor is at line " + pos.line + " char " + pos.ch);
                                    
            //do insertion
			// document.replaceRange(output, {line: pos.line, ch: pos.ch}, {line: pos.line, ch: pos.ch});
			console.log("\t\t*trigger text replaced with snippet*");
			document.replaceRange(output, start, end);
			
			pos = editor.getCursorPos();
			console.log("\t\tafter insert cursor is at line " + pos.line + " char " + pos.ch);
            
            //set curosr
            if (linePos >= 0) {
                editor._codeMirror.setCursor((start.line + linePos), (start.ch + charPos));
				console.log("\t\tcursor position set to line " + (start.line + linePos) + " char " + (start.ch + charPos));
            }
            
            //indent lines
			if( lines.length > 1 ) {
				console.log("\t\tindenting lines");
	            for (x = 0; x < lines.length; x++) {
	                editor._codeMirror.indentLine(pos.line + x);
	            }
			}
            
            //give focus back
            EditorManager.focusEditor();
        }
		
        function startInsert(output,start,end) {
			console.log("startInsert");
			console.log("\toutput: " + output);
            //find variables
            var tmp = output.match(/\$\$\{[0-9A-Z_a-z]{1,32}\}/g);
             //remove duplicate variables
            var snippetVariables = [],
                j;
                        
            if (tmp && tmp.length > 0) {
                for (j = 0; j < tmp.length; j++) {
                    if ($.inArray(tmp[j], snippetVariables) === -1) {
                        snippetVariables.push(tmp[j]);
                    }
                }
            }
			
			// CommandManager.execute(Commands.EDIT_DELETE_LINES); //delete the input line before the final insert is complete
            
            //if the same number of variables
            if (props.length - 1 >= snippetVariables.length) {
				console.log("\tcorrect number of variables available, complete insert");
                var x;
                for (x = 0; x < snippetVariables.length; x++) {
                    //even my escapes have escapes
                    var re = new RegExp(snippetVariables[x].replace('$${', '\\$\\$\\{').replace('}', '\\}'), 'g');
                    output = output.replace(re, props[x + 1]);
                }
                completeInsert(editor, output, start, end);
            } else {
				console.log("\tincorrect number of variables available, use inline widget to complete");
                var snippetPromise,
                    result = new $.Deferred();
                snippetPromise = inlineSnippetFormProvider(editor, snippetVariables, output);
                
                snippetPromise.done(function (inlineWidget) {
                    var newPos = {line: pos.line - 1, ch: pos.ch};
                    editor.addInlineWidget(newPos, inlineWidget);
                    var inlineComplete = function () {
                        var z;
                        for (z = 0; z < snippetVariables.length; z++) {
                            //even my escapes have escapes
                            var re = new RegExp(snippetVariables[z].replace('$${', '\\$\\$\\{').replace('}', '\\}'), 'g');
                            output = output.replace(re, inlineWidget.$form.find('.snipvar-' + snippetVariables[z].replace('$${', '').replace('}', '')).val());
                        }
                        
                        completeInsert(editor, output, start, end);
                    };
                    inlineWidget.$form.on('complete', function () {
                        inlineComplete();
                        inlineWidget.close();
                    });
                }).fail(function () {
                    result.reject();
                    console.log("Can't create inline snippet form");
                });
            }
        }
                
        function readSnippetFromFile(fieName) {
            var snippetFile = new NativeFileSystem.FileEntry(directory + '/snippets/' + fieName);
            FileUtils.readAsText(snippetFile)
                .done(function (text, readTimestamp) {
                    startInsert(SnippetPresets.execute(text));
                }).fail(function (error) {
                    FileUtils.showFileOpenError(error.code, snippetFile);
                });
        }
        
		var insertComplete = false;
        
		console.log("\tline length is: " + line.length);
		if( line.length > 0 ) {   
		// if (props.length) {
            //try to find the snippet, given the trigger text
			console.log("\ttrying to find a snippet");
			
			var start = pos.ch;
			var end   = pos.ch;
			
			while(start > 0) {
				var str = document.getRange({line: pos.line, ch: --start}, {line: pos.line, ch: end});
				props = str.split(" ");
				
				console.log("\t\tchecking " + props);
							
	            var i;
	            for (i = 0; i < snippets.length; i++) {
	                if (snippets[i].trigger === props[0]) {
						console.log("\tsnippet found at " + start + " to " + end);
						
	                    var output = snippets[i].template;
	                    if (output.indexOf('.snippet') === output.length - 8) {
	                        readSnippetFromFile(output);
	                    } else {
	                        startInsert(SnippetPresets.execute(output), {line: pos.line, ch: start}, {line: pos.line, ch: end});
	                    }
						
						//remove the trigger text
						// document.replaceRange("", {line: pos.line, ch: start}, {line: pos.line, ch: end});
						
						insertComplete = true;
	                    break;
	                }
	            }
				
				if(insertComplete) {
					break;
				}
			}
        }
		
		if(! insertComplete) {
        	console.log("\t\tno snippet found, inserting tab");
			document.replaceRange("\t", {line: pos.line, ch: pos.ch}, {line: pos.line, ch: pos.ch});
		}
    }
    
    //builds the snippets table
    function setupSnippets() {
		console.log("setupSnippets");
        var s = Mustache.render(panelHtml);
        panel = PanelManager.createBottomPanel(VIEW_HIDE_SNIPPETS, $(s), 100);
        panel.hide();
        
        $snippetsPanel = $('#snippets');
        $snippetsContent = $snippetsPanel.find(".resizable-content");
        $snippetsPanel.find(".snippets-close").click(function () {
            CommandManager.execute(VIEW_HIDE_SNIPPETS);
        });
    }
    
    function finalizeSnippetsTable() {
		console.log("finalizeSnippetsTable");
        var i,
            len,
            $snippetsTable;
        for (i = 0, len = arguments.length; i < len; i++) {
            if (arguments[i] && arguments[i].length) {
                snippets = snippets.concat(arguments[i]);
            }
        }
        $snippetsTable = Mustache.render(snippetsHTML, {"snippets" : snippets});
        $snippetsPanel.find('.resizable-content').append($snippetsTable);
        $snippetsPanel.find('.snippets-trigger').on('click', function () {
            CommandManager.execute(SNIPPET_EXECUTE, [$(this).attr('data-trigger')]);
        });
        $snippetsPanel.find('.snippets-source').on('click', function () {
            CommandManager.execute(Commands.FILE_OPEN, { fullPath: directory + "/" + $(this).attr('data-source') });
        });
    }
            
    //parse a JSON file with a snippet in it
    function loadSnippet(fileEntry) {
		console.log("loadSnippet");
        var result = new $.Deferred();
        if (fileEntry.isDirectory) {
            return;
        }
        FileUtils.readAsText(fileEntry)
            .done(function (text, readTimestamp) {
                try {
                    //TODO: a better check for valid snippets
                    var newSnippets = JSON.parse(text);
                    newSnippets.forEach(function (item) {
                        item.source = fileEntry.name;
                    });
                    result.resolve(newSnippets);
                } catch (e) {
                    console.log("Can't parse snippets from " + fileEntry.fullPath);
                    result.reject("Can't parse snippets from " + fileEntry.fullPath);
                }
            })
            .fail(function (error) {
                FileUtils.showFileOpenError(error.name, fileEntry.fullPath);
                result.reject(error.name + ": " + fileEntry.fullPath);
            });
        return result;
    }
    	
    CommandManager.register("Run Snippet", SNIPPET_EXECUTE, _handleSnippet);
    CommandManager.register("Show Snippets", VIEW_HIDE_SNIPPETS, _handleHideSnippets);
    
    function init() {
        console.log("init")
		
		//add the HTML UI
        setupSnippets();
        
        ExtensionUtils.loadStyleSheet(module, "snippets.css");
        
        //add the menu and keybinding for view/hide
        var menu = Menus.getMenu(Menus.AppMenuBar.VIEW_MENU);
        menu.addMenuItem(VIEW_HIDE_SNIPPETS, "Ctrl-Shift-S", Menus.AFTER, Commands.VIEW_HIDE_SIDEBAR);
        
        //add the keybinding
        // KeyBindingManager.addBinding(SNIPPET_EXECUTE, "Ctrl-Alt-V");
		KeyBindingManager.addBinding(SNIPPET_EXECUTE, "Tab");
		console.log("\tadded key binding");
                
        //snippet module's directory
        var moduleDir = FileUtils.getNativeModuleDirectoryPath(module);
        var configFile = new NativeFileSystem.FileEntry(moduleDir + '/config.js');
  
        FileUtils.readAsText(configFile)
            .done(function (text, readTimestamp) {
                var config = {};
                
                //try to parse the config file
                try {
                    config = JSON.parse(text);
                } catch (e) {
                    console.log("Can't parse config.js - " + e);
                    config.dataDirectory = "data";
                }
                directory = moduleDir + "/" + config.dataDirectory;
                
                //Look for any marker of a non relative path
                if (config.dataDirectory.indexOf("/") !== -1 || config.dataDirectory.indexOf("\\") !== -1) {
                    directory = config.dataDirectory;
                }
                //loop through the directory to load snippets
                NativeFileSystem.requestNativeFileSystem(directory,
                    function (rootEntry) {
                        rootEntry.root.createReader().readEntries(
                            function (entries) {
                                var i, loading = [], len = entries.length;
                                for (i = 0; i < len; i++) {
                                    loading.push(loadSnippet(entries[i]));
                                }
                                $.when.apply(module, loading).done(finalizeSnippetsTable);
                            },
                            function (error) {
                                console.log("[Snippets] Error -- could not read snippets directory: " + directory);
                            }
                        );
                    },
                    function (error) {
                        console.log("[Snippets] Error -- could not open snippets directory: " + directory);
                    });
           
            })
            .fail(function (error) {
                FileUtils.showFileOpenError(error.code, configFile);
            });

    }
    
    init();
    
});
