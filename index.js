'use strict';

var crypto = require('crypto'),
	path = require('path'),
	sriToolbox = require('sri-toolbox'),
	through = require('through'),
	assign = require('object-assign'),
	defaults = require('lodash.defaults'),
	PluginError = require('plugin-error'),
	Vinyl = require('vinyl'),
	Promise = require('bluebird'),
	DEFAULT_OPTIONS = {
		fileName: 'sri.json',
		transform: Object,
		formatter: JSON.stringify,
	},
	OPTION_TYPES = {
		fileName: ['String'],
		algorithms: ['Array'],
		transform: ['Function'],
		formatter: ['Function'],
	},
	hashesStore = {}; // options.fileName: { relativePath: hash }

function error(msg) {
	return new PluginError('gulp-sri', msg);
}

function hash(file, options) {
	return sriToolbox.generate({
		algorithms: options.algorithms
	}, file.contents);
}

function sliceHash(hash, options) {
	// positive length = leading characters; negative = trailing
	return options.length
		? options.length > 0
			? hash.slice(0, options.length)
			: hash.slice(options.length)
		: hash;
}

function relativePath(projectPath, filePath) {
	return path.relative(projectPath, filePath).replace(/\\/g, '/');
}

function getType(value) {
	return {}.toString.call(value).slice(8, -1);
}

function assignOptions(options) {
	if (typeof options === 'string') options = { fileName: options };
	options = options || {};

	Object.keys(options).forEach(function(option) {
		if (!OPTION_TYPES.hasOwnProperty(option)) throw error('Unsupported option: ' + option);
		if (options[option] !== undefined && !~OPTION_TYPES[option].indexOf(getType(options[option]))) throw error('`options.' + option + '` must be of type ' + OPTION_TYPES[option].join(' or '));
	});

	return defaults({}, options, DEFAULT_OPTIONS);
}

module.exports = exports = function(options) {
	options = assignOptions(options);
	var hashes = hashesStore[options.fileName] = hashesStore[options.fileName] || {},
		hashingPromises = [];

	function hashFile(file) {
		if (file.isNull()) return; // ignore
		if (file.isStream()) return this.emit('error', error('Streaming not supported'));

		// start hashing files as soon as they are received for maximum concurrency
		hashingPromises.push(
			Promise.try(hash.bind(undefined, file, options)).then(function(hashed) {
				if (typeof hashed !== 'string') throw error('Return/fulfill value must be a string');
				hashes[relativePath(file.cwd, file.path)] = sliceHash(hashed, options);
			})
		);
	}

	function endStream() {
		Promise.all(hashingPromises).bind(this).then(function() {
			return options.transform.call(undefined, assign({}, hashes));
		}).then(function(transformed) {
			return options.formatter.call(undefined, transformed);
		}).then(function(formatted) {
			if (typeof formatted !== 'string') throw error('Return/fulfill value of `options.formatter` must be a string');

			this.emit('data', new Vinyl({
				path: path.join(process.cwd(), options.fileName),
				contents: Buffer.from(formatted),
			}));
			this.emit('end');
		}).catch(function(err) {
			this.emit('error', err instanceof PluginError ? err : error(err));
		});
	}
	return through(hashFile, endStream);
};

// for testing. Don't use, may be removed or changed at anytime
assign(exports, {
	_Promise: Promise,
	_DEFAULT_OPTIONS: DEFAULT_OPTIONS,
	_error: error,
	_hash: hash,
	_relativePath: relativePath,
	_getType: getType,
	_assignOptions: assignOptions,
	_reset: function() {
		hashesStore = {};
	},
});
