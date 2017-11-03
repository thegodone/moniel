/*
	This code is a mess.
*/

const pixelWidth = require('string-pixel-width')

class Interpreter {
	// maybe singleton?
	logger = new Logger()
	graph = new ComputationalGraph(this)

	// too soon, should be in VisualGraph
	colorHash = new ColorHashWrapper()

	definitions = {};

	constructor() {
		this.initialize();
	}

	initialize() {
		this.graph.initialize();
		this.logger.clear();

		this.definitions = [];
		this.addDefaultDefinitions();
	}

	addDefaultDefinitions() {
		// console.info(`Adding default definitions.`);
		const defaultDefinitions = ["Add", "Linear", "Input", "Output", "Placeholder", "Variable", "Constant", "Multiply", "Convolution", "Dense", "MaxPooling", "BatchNormalization", "Deconvolution", "AveragePooling", "AdaptiveAveragePooling", "AdaptiveMaxPooling", "MaxUnpooling", "LocalResponseNormalization", "ParametricRectifiedLinearUnit", "LeakyRectifiedLinearUnit", "RandomizedRectifiedLinearUnit", "LogSigmoid", "Threshold", "HardTanh", "TanhShrink", "HardShrink", "LogSoftMax", "SoftShrink", "SoftMax", "SoftMin", "SoftPlus", "SoftSign", "Identity", "RectifiedLinearUnit", "Sigmoid", "ExponentialLinearUnit", "Tanh", "Absolute", "Summation", "Dropout", "MatrixMultiply", "BiasAdd", "Reshape", "Concat", "Flatten", "Tensor", "Softmax", "CrossEntropy", "ZeroPadding", "RandomNormal", "TruncatedNormalDistribution", "DotProduct"];
		defaultDefinitions.forEach(definition => this.addDefinition(definition));
	}

	addDefinition(definitionName) {
		this.definitions[definitionName] = {
			name: definitionName,
			color: this.colorHash.hex(definitionName)
		};
	}

	execute(ast) {
		this.initialize()
		this.walkAst(ast)
	}

	handleInlineMetanode(node) {
		const identifier = node.name ? node.name.value : this.graph.generateInstanceId("metanode")

		this.graph.enterMetanodeScope(identifier)
		this.walkAst(node.body);
		this.graph.exitMetanodeScope();
		this.graph.createMetanode(identifier, identifier, {
			userGeneratedId: node.name ? node.name.value : undefined,
			id: identifier,
			class: "",
			_source: node._source
		});
	}

	handleNodeDefinition(nodeDefinition) {
		// console.info(`Adding "${nodeDefinition.name}" to available definitions.`);
		this.addDefinition(nodeDefinition.name);
		if (nodeDefinition.body) {
			this.graph.enterMetanodeScope(nodeDefinition.name);
			this.walkAst(nodeDefinition.body);
			this.graph.exitMetanodeScope();
		}
	}

	handleMetaNode(metanode) {
		metanode.definitions.forEach(definition => this.walkAst(definition));
	}

	handleGraphDefinition(graph) {
		graph.definitions.forEach(definition => this.walkAst(definition));
	}

	handleChainDefinition(chain) {
		this.graph.clearNodeStack();
		// console.log(connection.list)
		chain.blocks.forEach(item => {
			this.graph.freezeNodeStack();
			// console.log(item)
			this.walkAst(item);
		});
	}

	// this is doing too much – break into "not recognized", "success" and "ambiguous"
	handleNode(instance) {
		var node = {
			id: undefined,
			class: "Unknown",
			color: "darkgrey",
			height: 30,
			width: 100,

			_source: instance,
		};

		let definitions = this.matchInstanceNameToDefinitions(instance.name.value)
		// console.log(`Matched definitions:`, definitions);

		if (definitions.length === 0) {
            node.class = instance.name.value;
            node.isUndefined = true

            this.addIssue({
            	message: `Unrecognized node type "${instance.name.value}". No possible matches found.`,
            	position: {
					start:  instance.name._source.startIdx,
					end:  instance.name._source.endIdx
				},
            	type: "error"
            });
        } else if (definitions.length === 1) {
			let definition = definitions[0];
			if (definition) {
				node.color = definition.color;
				node.class = definition.name;
			}
		} else {
			node.class = instance.name.value;
			this.addIssue({
				message: `Unrecognized node type "${instance.name.value}". Possible matches: ${definitions.map(def => `"${def.name}"`).join(", ")}.`,
				position: {
					start:  instance.name._source.startIdx,
					end:  instance.name._source.endIdx
				},
				type: "error"
			});
		}

		if (!instance.alias) {
			node.id = this.graph.generateInstanceId(node.class);
		} else {
			node.id = instance.alias.value;
			node.userGeneratedId = instance.alias.value;
			node.height = 50;
		}

		// is metanode
		if (Object.keys(this.graph.metanodes).includes(node.class)) {
			var color = d3.color(node.color);
			color.opacity = 0.1;
			this.graph.createMetanode(node.id, node.class, {
				...node,
				style: {"fill": color.toString()}
			});
			return;
		}

		const width = 20 + Math.max(...[node.class, node.userGeneratedId ? node.userGeneratedId : ""].map(string => pixelWidth(string, {size: 16})))

		this.graph.createNode(node.id, {
			...node,
            style: {fill: node.color},
			width
        });
	}

	handleList(list) {
		list.list.forEach(item => this.walkAst(item));
	}

	handleIdentifier(identifier) {
		this.graph.referenceNode(identifier.value);
	}

	matchInstanceNameToDefinitions(query) {
		var definitions = Object.keys(this.definitions);
		let definitionKeys = Interpreter.nameResolution(query, definitions);
		//console.log("Found keys", definitionKeys);
		let matchedDefinitions = definitionKeys.map(key => this.definitions[key]);
		return matchedDefinitions;
	}

	getComputationalGraph() {
		return this.graph.getGraph();
	}

	getMetanodesDefinitions() {
		return this.graph.getMetanodes()
	}

	getIssues() {
		return this.logger.getIssues();
	}

	addIssue(issue) {
		this.logger.addIssue(issue);
	}

	static nameResolution(partial, list) {
		let splitRegex = /(?=[0-9A-Z])/;
	    let partialArray = partial.split(splitRegex);
	    let listArray = list.map(definition => definition.split(splitRegex));
	    var result = listArray.filter(possibleMatch => Interpreter.isMultiPrefix(partialArray, possibleMatch));
	    result = result.map(item => item.join(""));
	    return result;
	}

	static isMultiPrefix(name, target) {
	    if (name.length !== target.length) { return false; }
	    var i = 0;
	    while(i < name.length && target[i].startsWith(name[i])) { i += 1; }
	    return (i === name.length); // got to the end?
	}

	handleUnrecognizedNode(node) {
		console.warn("What to do with this AST node?", node);
	}

	walkAst(node) {
		if (!node) { console.error("No node?!"); return; }

		switch (node.kind) {
			case "Graph": this.handleGraphDefinition(node); break;
			case "NodeDefinition": this.handleNodeDefinition(node); break;
			case "MetaNode": this.handleMetaNode(node); break;
			case "InlineMetanode": this.handleInlineMetanode(node); break;
			case "Chain": this.handleChainDefinition(node); break;
			case "Node": this.handleNode(node); break;
			case "List": this.handleList(node); break;
			case "Identifier": this.handleIdentifier(node); break;
			default: this.handleUnrecognizedNode(node);
		}
	}
}