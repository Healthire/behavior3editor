this.b3editor = this.b3editor || {};

(function() {
  "use strict";

  var Editor = b3.Class(createjs.EventDispatcher);

  var p = Editor.prototype;
  
  p.initialize = function() {
    this.storage = new b3editor.StorageProxy();
    this.storage.provider = new b3editor.LocalStorage();
    this.settings = new b3editor.SettingsManager();
    this.settings.load(b3editor.OPTIONS);
    this.settings.load(b3editor.THEME_DARK);
    this.settings.load(b3editor.SHORTCUTS);
    this.canvas = new b3editor.Game(this.settings);
    app.editor = this;
    app.settings= this.settings;
    app.game = this.canvas;

    // MODELS
    this.project = new b3editor.Project();
    this.tree = null
    this.trees = [];

    // TREE
    this.blocks           = [];
    this.connections      = [];
    this.selectedBlocks   = [];

    // PROJECT
    this.nodes            = {};
    this.clipboard        = [];

    // WHOLE
    this.symbols          = {};
    this.shapes           = {};
    this.systems          = [];

    // TEMP
    this.selectionBox     = new b3editor.SelectionBox();

    this.organizer   = new b3editor.Organizer();

    // register system
    var params = {editor:this, canvas:this.canvas};
    this.registerSystem(new b3editor.CameraSystem(params));
    this.registerSystem(new b3editor.SelectionSystem(params));
    this.registerSystem(new b3editor.DragSystem(params));
    this.registerSystem(new b3editor.ConnectionSystem(params));

    // register shape
    this.registerShape('root',      b3editor.draw.rootShape);
    this.registerShape('composite', b3editor.draw.compositeShape);
    this.registerShape('decorator', b3editor.draw.decoratorShape);
    this.registerShape('module', b3editor.draw.conditionShape);
    this.registerShape('action',    b3editor.draw.actionShape);

    // register symbol
    this.registerSymbol('Root',         b3editor.draw.rootSymbol);
    this.registerSymbol('sequence',  b3editor.draw.memsequenceSymbol);
    this.registerSymbol('dynamic',     b3editor.draw.prioritySymbol);
    this.registerSymbol('selector',  b3editor.draw.memprioritySymbol);

    // register root node
    this.registerNode(b3editor.Root);

    this.canvas.layerOverlay.addChild(this.selectionBox.displayObject);

    this.addTree();
    this.center();
  };

  // INTERNAL =================================================================
  p.trigger = function(name, target, variables) {
    variables = variables || {};

    var event = new createjs.Event(name)
    event._target = target;
    for (key in variables) {
      event[key] = variables[key];
    }
    this.dispatchEvent(event);
  }
  p.registerNode = function(node) {
    // TODO: raise error if node is invalid
    var name = node.prototype.name;
    this.nodes[name] = node;
  }
  p.registerSymbol = function(type, symbol) {
    if (!symbol) {
      symbol = type;
    }
    this.symbols[type] = symbol;
  }
  p.registerShape = function(name, shape) {
    this.shapes[name] = shape;
  }
  p.registerSystem = function(system, priority) {
    if (priority) {
      this.systems.splice(0, 0, system);
    } else {
      this.systems.push(system);
    }
  }
  p.getRoot = function() {
    for (var i=0; i<this.blocks.length; i++) {
      if (this.blocks[i].type === 'root') {
        return this.blocks[i];
      }
    }
  }
  p.getBlockUnder = function(x, y) {
    if (!x || !y) {
      var point = this.canvas.getLocalMousePosition();
      x = point.x;
      y = point.y;
    }

    // Get block under the mouse
    for (var i=this.blocks.length-1; i>=0; i--) {
      var block = this.blocks[i];

      // Verify collision
      if (block.hitTest(x, y)) {
        return block;
      }
    }
  }
  p.getBlockById = function(id) {
    for (var i=0; i<this.blocks.length; i++) {
      var block = this.blocks[i];
      if (block.id == id) {
        return block;
      }
    }
  }
  p.applySettings = function(settings) {
    var settings = settings || this.settings;
    this.canvas.applySettings(settings);
    for (var i=0; i<this.blocks.length; i++) {
      this.blocks[i].applySettings(settings);
    }
    for (var i=0; i<this.connections.length; i++) {
      this.connections[i].applySettings(settings);
    }
  }
  p.importNode = function(node, parent) {
    if (node.type == 'module') {
      node.name = node.path;
    } 

    if (!this.nodes[node.name]) {
      if (node.type == "control") node.type = "composite"; // Stupid format conversion
      this.addNode(node.name, node.name, node.type);
    }

    var block = this.addBlock(node.name, 0, 0);
    block.id = b3.createUUID();
    block.title = node.title;
    block.description = node.description;
    block.properties = node.parameters;

    block.redraw();

    if (parent) {
      var outBlock = this.getBlockById(parent);
      this.addConnection(outBlock, block);
    }

    if (node.children) {
      for (var i=0; i<node.children.length; i++) {
        this.importNode(node.children[i], block.id);
      }
    }
    if (node.child) {
      this.importNode(node.child, block.id);
    }

    return block
  }
  p.importFromJSON = function(json) {
    this.reset();

    var data = JSON.parse(json);
    var dataRoot = this.importNode(data.root);
 
    var root = this.getRoot();
    root.title = data.name;
    root.properties["scripts"] = data.scripts;
    this.addConnection(root, dataRoot);

    this.organize(true);
  }
  p.exportBlock = function(block) {
    var data = {};

    if (block.type == "module") {
      data.type = "module";
      data.path = block.name;
      return data;
    }

    data.title = block.title;
    data.type = block.type;
    data.name = block.name;
    data.parameters = block.properties;

    var children = block.getOutNodeIdsByOrder();
    if (children.length > 0) {
      if (block.type == "composite") {
        data.type = "control"; // Stupid format conversion
        data.children = [];
        for (var i=0; i<children.length; i++) {
          data.children[i] = this.exportBlock(this.getBlockById(children[i]));
        }
      } else if (block.type == "decorator") {
        data.child = this.exportBlock(this.getBlockById(children[0]));
      }
    }

    return data;
  }
  p.exportToJSON = function() {
    var root = this.getRoot();
    var data = {};

    // Tree data
    data.name = root.title;
    data.description = root.description;
    data.scripts = root.properties.scripts;

    var rootBlock = root.getOutNodeIds()[0]
    data.root = this.exportBlock(this.getBlockById(rootBlock));

    return JSON.stringify(data, null, 2);
  }
  p.addNode = function(name, title, type) {
    if (this.nodes[name]) {
      this.trigger('notification', name, {
        level: 'error',
        message: 'Node named "'+name+'" already registered.'
      });
      return;
    }

    var classes = {
      'composite' : b3editor.Composite,
      'decorator' : b3editor.Decorator,
      'action' : b3editor.Action,
      'module' : b3editor.Module
    };
    var type = type;
    var cls = classes[type];
    
    var tempClass = b3.Class(cls);
    tempClass.prototype.name = name;
    tempClass.prototype.title = title;
    
    this.registerNode(tempClass);
    this.trigger('nodeadded', tempClass);
  }
  p.editNode = function(oldName, newName, newTitle) {
    var node = this.nodes[oldName];
    if (!node) return;
    
    if (oldName !== newName && this.nodes[newName]) {
      this.trigger('notification', newName, {
        level: 'error',
        message: 'Node named "'+newName+'" already registered.'
      });
      return;
    }

    delete this.nodes[oldName];
    this.nodes[newName] = node;

    var oldTitle = node.prototype.title;
    node.prototype.name = newName;
    node.prototype.title = newTitle;
    
    for (var i=this.blocks.length-1; i>=0; i--) {
      var block = this.blocks[i];
      if (block.node === node) {
        block.name = newName;
        if (block.title === oldTitle || block.title === oldName) {
          block.title = newTitle || newName;
        }
        block.redraw();
      }
    }

    this.trigger('nodechanged', node);
  }
  p.removeNode = function(name) {
    // TODO: verify if it is b3 node
    this.deselectAll();

    var node = this.nodes[name];

    for (var i=this.blocks.length-1; i>=0; i--) {
      var block = this.blocks[i];
      if (block.node === node) {
        this.removeBlock(block);
      }
    }

    delete this.nodes[name];
    this.trigger('noderemoved', node);
  }
  p.addTree = function() {
    var block = new b3editor.Block(this.nodes['Root']);
    block.displayObject.x = 0;
    block.displayObject.y = 0;

    var tree = new b3editor.Tree();
    tree.id = block.id;
    tree.blocks = [block];
    this.trees.push(tree);

    this.trigger('treeadded', tree);

    this.selectTree(tree.id);
    this.select(this.blocks[0]);
    this.center();

    return tree;
  }
  p.selectTree = function(id) {
    var tree = this.tree;
    if (tree) {
      tree.blocks = this.blocks;
      tree.connections = this.connections;
      tree.selectedBlocks = this.selectedBlocks;
      tree.camera = {
        'camera_x' : this.canvas.camera.x,
        'camera_y' : this.canvas.camera.y,
        'camera_z' : this.canvas.camera.scaleX,
        'x'        : this.blocks[0].displayObject.x,
        'y'        : this.blocks[0].displayObject.y
      }
    }

    for (var i=0; i<this.trees.length; i++) {
      tree = this.trees[i];
      if (tree.id === id) {
        this.tree = tree;

        this.blocks = tree.blocks;
        this.connections = tree.connections;
        this.selectedBlocks = tree.selectedBlocks;

        this.canvas.layerBlocks.removeAllChildren();
        this.canvas.layerConnections.removeAllChildren();

        for (var i=0; i<this.blocks.length; i++) {
          this.canvas.layerBlocks.addChild(this.blocks[i].displayObject);
        }
        for (var i=0; i<this.connections.length; i++) {
          this.canvas.layerConnections.addChild(this.connections[i].displayObject);
        }

        this.canvas.camera.x = tree.camera['camera_x'];
        this.canvas.camera.y = tree.camera['camera_y'];
        this.canvas.camera.scaleX = tree.camera['camera_z'];
        this.canvas.camera.scaleY = tree.camera['camera_z'];

        this.trigger('treeselected', tree);
        return;
      }
    }

    this.trigger('notification', id, {
      level: 'error',
      message: 'Trying to select an invalid tree.'
    });
  }
  p.removeTree = function(id) {
    var index = -1;
    var tree = null;
    for (var i=0; i<this.trees.length; i++) {      
      if (this.trees[i].id === id) {
        tree = this.trees[i];
        index = i;
        break;
      }
    }
    if (index > -1) {
      this.trees.splice(index, 1);

      if (tree === this.tree) {
        var id_ = null;
        if (index > 0) id_ = this.trees[index-1].id;
        else id_ = this.trees[index].id;

        this.selectTree(id_);
      }

      this.trigger('treeremoved', tree);
    }
  }
  // ==========================================================================
  
  // VIEWER ===================================================================
  p.zoom = function(factor) {
    this.canvas.camera.scaleX = factor;
    this.canvas.camera.scaleY = factor;
  }
  p.pan = function(x, y) {
    this.canvas.camera.x += x;
    this.canvas.camera.y += y;
  }
  p.setcam = function(x, y) {
    this.canvas.camera.x = x;
    this.canvas.camera.y = y;
  }
  p.center = function() {
    var hw = this.canvas.canvas.width/2;
    var hh = this.canvas.canvas.height/2;
    this.setcam(hw, hh);
  }
  p.organize = function(orderByIndex) {
    this.organizer.organize(this.getRoot(), orderByIndex);
  }
  p.reset = function(all) {
    // REMOVE BLOCKS
    for (var i=0; i<this.blocks.length; i++) {
      var block = this.blocks[i];
      this.canvas.layerBlocks.removeChild(block.displayObject);
    }
    this.blocks = [];

    // REMOVE CONNECTIONS
    for (var i=0; i<this.connections.length; i++) {
      var conn = this.connections[i];
      this.canvas.layerConnections.removeChild(conn.displayObject);
    }
    this.connections = [];

    this.canvas.camera.x = 0;
    this.canvas.camera.y = 0;
    this.canvas.camera.scaleX = 1;
    this.canvas.camera.scaleY = 1;

    if (!all) {
      this.addBlock('Root', 0, 0);
      this.tree.id = this.blocks[0].id;
      this.tree.blocks = [this.blocks[0]];
    }
  }
  p.snap = function(blocks) {
    if (!blocks) {
      blocks = this.blocks;
    }
    else if (Object.prototype.toString.call(blocks) !== '[object Array]') {
      blocks = [blocks];
    }

    var snap_x = this.settings.get('snap_x');
    var snap_y = this.settings.get('snap_y');

    for (var i=0; i<blocks.length; i++) {
      var block = blocks[i];
      block.displayObject.x -= block.displayObject.x%snap_x;
      block.displayObject.y -= block.displayObject.y%snap_y;
    }
  }
  p.addBlock = function(name, x, y) {
    x = x || 0;
    y = y || 0;

    if (typeof name == 'string') {
      var node = this.nodes[name];
    } else {
      var node = name;
    }

    var block = new b3editor.Block(node);
    block.displayObject.x = x;
    block.displayObject.y = y;

    this.blocks.push(block);
    this.canvas.layerBlocks.addChild(block.displayObject);

    this.deselectAll()
    this.select(block);

    return block;
  }
  p.addConnection = function(inBlock, outBlock) {
    var connection = new b3editor.Connection(this);

    if (inBlock) {
      connection.addInBlock(inBlock);
      inBlock.addOutConnection(connection);
    }

    if (outBlock) {
      connection.addOutBlock(outBlock);
      outBlock.addInConnection(connection);
    }

    this.connections.push(connection);
    this.canvas.layerConnections.addChild(connection.displayObject);

    connection.redraw();

    return connection;
  }
  p.editBlock = function(block, template) {
    var oldValues = {
      title       : block.title,
      description : block.description,
      properties  : block.properties
    }
    block.title       = template.title;
    block.description = template.description;
    block.properties  = template.properties;
    block.redraw();

    this.trigger('blockchanged', block, {
      oldValues: oldValues,
      newValues: template
    });
  }
  p.removeBlock = function(block) {
    var index = this.blocks.indexOf(block);
    if (index > -1) this.blocks.splice(index, 1);


    if (block.inConnection) {
      this.removeConnection(block.inConnection);
    }

    if (block.outConnections.length > 0) {
      for (var i=block.outConnections.length-1; i>=0; i--) {
        this.removeConnection(block.outConnections[i]);
      }
    }

    this.canvas.layerBlocks.removeChild(block.displayObject);
  }
  p.removeConnection = function(connection) {
    if (connection.inBlock) {
      connection.inBlock.removeOutConnection(connection);
      connection.removeInBlock();
    }

    if (connection.outBlock) {
      connection.outBlock.removeInConnection();
      connection.removeOutBlock();
    }

    var index = this.connections.indexOf(connection);
    if (index > -1) this.connections.splice(index, 1);

    this.canvas.layerConnections.removeChild(connection.displayObject);
  }
  // ==========================================================================
  
  // EDITOR INTERFACE =========================================================
  p.select = function(block) {
    if (block.isSelected) return;

    block.select();
    this.selectedBlocks.push(block)

    this.trigger('blockselected', block);
  }
  p.deselect = function(block) {
    if (!block.isSelected) return;

    block.deselect();
    var index = this.selectedBlocks.indexOf(block);
    if (index > -1) this.selectedBlocks.splice(index, 1);

    this.trigger('blockdeselected', block);
  }
  p.selectAll = function() {
    for (var i=0; i<this.blocks.length; i++) {
      this.select(this.blocks[i]);
    }
  }
  p.deselectAll = function() {
    for (var i=this.selectedBlocks.length-1; i>=0; i--) {
      this.deselect(this.selectedBlocks[i])
    }
  }
  p.invertSelection = function(block) {
    var blocks = (block)?[block]:this.blocks;

    for (var i=0; i<blocks.length; i++) {
      var block = blocks[i];

      if (block.isSelected) {
        this.deselect(block);
      } else {
        this.select(block);
      }
    }
  }

  p.copy = function() {
    this.clipboard = [];

    for (var i=0; i<this.selectedBlocks.length; i++) {
      var block = this.selectedBlocks[i];

      if (block.type != 'root') {
        this.clipboard.push(block)
      }
    }
  }
  p.cut = function() {
    this.clipboard = [];

    for (var i=0; i<this.selectedBlocks.length; i++) {
      var block = this.selectedBlocks[i];

      if (block.type != 'root') {
        this.removeBlock(block);
        this.clipboard.push(block)
      }
    }
    this.selectedBlocks = [];
  }
  p.paste = function() {
    var newBlocks = [];
    for (var i=0; i<this.clipboard.length; i++) {
      var block = this.clipboard[i];

      // Copy the block
      var newBlock = block.copy();
      newBlock.displayObject.x += 50;
      newBlock.displayObject.y += 50;

      // Add block to container
      this.blocks.push(newBlock)
      this.canvas.layerBlocks.addChild(newBlock.displayObject);
      newBlocks.push(newBlock);
    }

    // Copy connections
    // TODO: cubic complexity here! How to make it better?
    for (var i=0; i<this.clipboard.length; i++) {
      var oldBlock = this.clipboard[i];
      var newBlock = newBlocks[i];

      for (var j=0; j<oldBlock.outConnections.length; j++) {
        for (var k=0; k<this.clipboard.length; k++) {
          if (oldBlock.outConnections[j].outBlock === this.clipboard[k]) {
            this.addConnection(newBlock, newBlocks[k]);
            break;
          }
        }
      }
    }

    // Deselect old blocks and select the new ones
    this.deselectAll();
    for (var i=0; i<newBlocks.length; i++) {
      this.select(newBlocks[i]);
    }

    this.snap(newBlocks);
  }
  p.duplicate = function() {
    var tempClipboard = this.clipboard;
    this.copy();
    this.paste();
    this.clipboard = tempClipboard;
  }
  p.remove = function() {
    var root = null;
    for (var i=0; i<this.selectedBlocks.length; i++) {
      if (this.selectedBlocks[i].type == 'root') {
        root = this.selectedBlocks[i];
      } else {
        this.removeBlock(this.selectedBlocks[i]);
      }
    }

    this.deselectAll();
    if (root) {
      this.select(root);
    }
  }

  p.removeConnections = function() {
    for (var i=0; i<this.selectedBlocks.length; i++) {
      var block = this.selectedBlocks[i];

      if (block.inConnection) {
        this.removeConnection(block.inConnection);
      }

      if (block.outConnections.length > 0) {
        for (var j=block.outConnections.length-1; j>=0; j--) {
          this.removeConnection(block.outConnections[j]);
        }
      }
    }
  }
  p.removeInConnections = function() {
    for (var i=0; i<this.selectedBlocks.length; i++) {
      var block = this.selectedBlocks[i];

      if (block.inConnection) {
        this.removeConnection(block.inConnection);
      }
    }
  }
  p.removeOutConnections = function() {
    for (var i=0; i<this.selectedBlocks.length; i++) {
      var block = this.selectedBlocks[i];

      if (block.outConnections.length > 0) {
        for (var j=block.outConnections.length-1; j>=0; j--) {
          this.removeConnection(block.outConnections[j]);
        }
      }
    }
  }

  p.zoomIn = function() {
    var min = this.settings.get('zoom_min');
    var max = this.settings.get('zoom_max');
    var step = this.settings.get('zoom_step');
    
    var zoom = this.canvas.camera.scaleX;
    this.zoom(creatine.clip(zoom+step, min, max));
  }
  p.zoomOut = function() {
    var min = this.settings.get('zoom_min');
    var max = this.settings.get('zoom_max');
    var step = this.settings.get('zoom_step');
    
    var zoom = this.canvas.camera.scaleX;
    this.zoom(creatine.clip(zoom-step, min, max));
  }

  p.preview = function(name) {
    var canvas = document.createElement('canvas');
    canvas.setAttribute('width', '400');
    canvas.setAttribute('height', '200');
    canvas.setAttribute('class', 'preview grabbing');

    var node = this.nodes[name];
    var block = new b3editor.Block(node);
    var shape = block.displayObject;
    shape.x = 200;
    shape.y = 100;
    var stage = new createjs.Stage(canvas);
    stage.addChild(shape);
    stage.update();

    var img = document.createElement("img");
    img.src = canvas.toDataURL();

    return img;
  }
  // ==========================================================================

  b3editor.Editor = Editor;
}());
