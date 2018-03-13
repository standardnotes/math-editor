document.addEventListener("DOMContentLoaded", function(event) {

  let editor = document.getElementById("editor-source");

  var workingNote;

  let permissions = [
    {
      name: "stream-context-item"
    }
  ];

  var componentManager = new ComponentManager(permissions, function(){
    // on ready
  });

  // componentManager.loggingEnabled = true;

  componentManager.streamContextItem((note) => {
    workingNote = note;

     // Only update UI on non-metadata updates.
    if(note.isMetadataUpdate) {
      return;
    }

    editor.value = note.content.text;
    window.upmath.updateText();
  });

  editor.addEventListener("input", function(event){
    var text = editor.value || "";
    if(workingNote) {
      workingNote.content.text = text;
      componentManager.saveItem(workingNote);
    }
  });

  // Tab handler
  editor.addEventListener('keydown', function(event){
    if (!event.shiftKey && event.which == 9) {
      event.preventDefault();

      console.log(document);

      // Using document.execCommand gives us undo support
      if(!document.execCommand("insertText", false, "\t")) {
        // document.execCommand works great on Chrome/Safari but not Firefox
        var start = this.selectionStart;
        var end = this.selectionEnd;
        var spaces = "    ";

         // Insert 4 spaces
        this.value = this.value.substring(0, start)
          + spaces + this.value.substring(end);

        // Place cursor 4 spaces away from where
        // the tab key was pressed
        this.selectionStart = this.selectionEnd = start + 4;
      }
    }
  });

});
