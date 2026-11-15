'use strict';
const utils = require('../utils');
var msm = require('../scripts/msm');
const dayjs = require('dayjs');
const duration = require('dayjs/plugin/duration');
dayjs.extend(duration);

module.exports = {
    runtime_: Object,
    msm_: Object,

    init: function(runtime) {
        this.runtime_ = runtime;
        this.msm_ = msm.create(this.runtime_.events,this.runtime_.logger);
        try {
            this.runtime_.project.getScripts().then(scripts =>{
                this.msm_.loadScripts(scripts);
            }).catch((err) => {
                console.log(err);
            });
        } catch (err) {
            console.log(err);
        }
    },

    tagDaqToSave: function (tag, timestamp) {
        if (tag.daq && (tag.daq.enabled || tag.daq.restored)) {
            tag.timestamp = timestamp;
            if (tag.changed && (tag.daq.changed || tag.daq.restored)) {
                return true;
            } else if (!tag.daq.lastDaqSaved || timestamp - parseInt(tag.daq.interval) * 1000 > tag.daq.lastDaqSaved) {
                tag.daq.lastDaqSaved = timestamp;
                return true;
            }
        }
        return false;
    },

    tagValueCompose: async function (value, oldValue, tag, runtime = undefined) {
        var obj = {value: null };
        if (tag) {
            try {
                if (tag.scaleReadFunction) {
                    value = await callScaleScript(tag.scaleReadFunction, tag.scaleReadParams ? tag.scaleReadParams : undefined, runtime, true, value);
                }
                const type = tag?.type;
                // Number([42]) and Number(new Float64Array([42])) are numeric,
                // but collection values must not enter the scalar scaling path.
                const isCollection = Array.isArray(value) || ArrayBuffer.isView(value);
                if (!isCollection && !(type === 'String' || type === 'ByteString' || type === 'string') && utils.isNumber(value, obj)) {
                    value = obj.value;
                    if (tag.deadband && tag.deadband.value && !utils.isNullOrUndefined(oldValue)) {
                        if (Math.abs(value - oldValue) <= tag.deadband.value) {
                            value = oldValue;
                        }
                    }
                    if (tag.scale) {
                        if (tag.scale.mode === 'linear') {
                            value = (tag.scale.scaledHigh - tag.scale.scaledLow) * (value - tag.scale.rawLow) / (tag.scale.rawHigh - tag.scale.rawLow) + tag.scale.scaledLow;
                        } else if (tag.scale.mode === 'convertDateTime' && tag.scale.dateTimeFormat) {
                            value = dayjs(value).format(tag.scale.dateTimeFormat);
                        } else if (tag.scale.mode === 'convertTickTime' && tag.scale.dateTimeFormat) {
                            value = durationToTimeFormat(dayjs.duration(value), tag.scale.dateTimeFormat);
                        } else if (tag.scale.mode === 'expression' && tag.scale.readExpression) {
                            value = evaluateExpression(tag.scale.readExpression, value);
                        }
                    }
                    if (tag.format) {
                        value = +value.toFixed(tag.format);
                    }
                } else if (tag.rawValue != null) {
                    // FUXA-B: non-numeric payloads (e.g. JSON objects) scaled by a named server script
                    value = tag.rawValue;
                    if (tag.scale && tag.scale.mode === 'functionName' && tag.scale.functionName) {
                        try {
                            let _sn = this.msm_.getScriptByName(tag.scale.functionName);
                            if (_sn) {
                                _sn.parameters[0].value = value;
                                value = this.msm_.runScriptWithReturn(_sn);
                            }
                        } catch (err) {
                            console.log("You must define the function:" + tag.scale.functionName + " at server side in device-utils.js or in FUXA scripts!");
                        }
                    }
                }
            } catch (err) {
                console.error(err);
            }
        }
        return value;
    },

    tagRawCalculator: async function (value, tag, runtime = undefined) {
        var obj = {value: null };

        if (tag) {
            try {
                if (utils.isNumber(value, obj)) {
                    value = obj.value;
                    if (tag.scale && tag.scale.mode === 'linear') {
                        value = tag.scale.rawLow + ((tag.scale.rawHigh - tag.scale.rawLow) * (value - tag.scale.scaledLow)) / (tag.scale.scaledHigh - tag.scale.scaledLow);
                    } else if (tag.scale && tag.scale.mode === 'expression' && tag.scale.writeExpression) {
                        value = evaluateExpression(tag.scale.writeExpression, value);
                    }
                }
                if (tag.scaleWriteFunction) {
                    value = await callScaleScript(tag.scaleWriteFunction, tag.scaleWriteParams ? tag.scaleWriteParams : undefined, runtime, false, value);
                }
            } catch (err) {
                console.error(err);
            }
        }
        return value;
    },

    parseValue: function (value, type) {
        if (type === 'number') {
            return parseFloat(value);
        } else if (type === 'boolean') {
            if (value === null || value === undefined || value === '') {
                return false;
            }
            if (typeof value === 'string') {
                const lowerValue = value.toLowerCase().trim();
                return lowerValue === 'true' || lowerValue === '1';
            }
            return Boolean(value);
        } else if (type === 'string') {
            return value;
        } else {
            let val = parseFloat(value);
            if (Number.isNaN(val)) {
                // maybe boolean
                val = Number(value);

                if (Number.isNaN(val)) {
                    val = value;
                }
            } else {
                val = parseFloat(val.toFixed(5));
            }
            return val;
        }
    }
}

function executeFunctionByName( functionName, context /*, args */ ) {
    var args, namespaces, func;

    if( typeof functionName === 'undefined' ) { throw 'function name not specified'; }

    if( typeof eval( functionName ) !== 'function' ) { throw functionName + ' is not a function'; }

    if( typeof context !== 'undefined' ) { 
        if( typeof context === 'object' && context instanceof Array === false ) { 
            if( typeof context[ functionName ] !== 'function' ) {
                throw context + '.' + functionName + ' is not a function';
            }
            args = Array.prototype.slice.call( arguments, 2 );

        } else {
            args = Array.prototype.slice.call( arguments, 1 );
            context = window;
        }

    } else {
        context = window;
    }

    namespaces = functionName.split( "." );
    func = namespaces.pop();

    for( var i = 0; i < namespaces.length; i++ ) {
        context = context[ namespaces[ i ] ];
    }

    return context[ func ].apply( context, args );
}

const durationToTimeFormat = (duration, format) => {
  const pattern = /^([H]+)?([:|-])?([m]+)?([:|-])?([s]+)?$/;
  const match = format.match(pattern);

  if (!match) {
    return null; // Format not valid
  }

  const [, hoursPart, separator1, minutePart, separator2, secondPart] = match;

  const nbDays = duration.get('days');
  const nbHours = duration.get('hours');
  const nbMinutes = duration.get('minute');
  const nbSeconds = duration.get('seconds');

  var count = nbDays * 24 + nbHours;
  var result = '';
  if (hoursPart) {
    result += `${count.toString().padStart(hoursPart.length, '0')}${separator1 ?? ''}`;
    count = nbMinutes;
  } else {
    count = count * 60 + nbMinutes;
  }
  if (minutePart) {
    result += `${count.toString().padStart(minutePart.length, '0')}${separator2 ?? ''}`;
    count = nbSeconds;
  } else {
    count = count * 60 + nbSeconds;
  }
  if (secondPart) {
    result += `${count.toString().padStart(secondPart.length, '0')}`;
  }
  return result;
}

const callScaleScript = async (scriptId, params, runtime, isRead, value) => {
    if (scriptId && runtime !== undefined) {
        let parameters = [
            { name: 'value', type: 'value', value: value }
        ];
        let tagParams = [];
        if (params) {
            try {
                tagParams = JSON.parse(params);
            } catch (error) {
                runtime.logger.error(`'${params}' error decoding ${isRead ? 'read' : 'write' } scale script params ${error.toString()}`);
            }
            parameters = [...parameters, ...tagParams];
        }
        const script = {
            id: scriptId,
            name: null,
            parameters: parameters,
            notLog: true
        };
        try {
            value = await runtime.scriptsMgr.runScript(script, false);
        } catch (error) {
            runtime.logger.error(`'${params}' ${isRead ? 'read' : 'write'} script error! ${error.toString()}`);
        }
        return value;
    }
    return value;
}

const evaluateExpression = (expression, value) => {
    try {
        // Create a function with 'this' bound to the value
        const func = new Function('return ' + expression);
        return func.call(value);
    } catch (error) {
        console.error(`Expression evaluation error: ${error.toString()}`);
        return null; // Return null to indicate failure, preventing wrong values
    }
}
