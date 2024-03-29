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

    tagValueCompose: function (value, tag) {
        var obj = {value: null };
        if (tag && utils.isNumber(value, obj)) {
            try {
                value = obj.value;
                if (tag.scale) {
                    if (tag.scale.mode === 'linear') {
                        value = (tag.scale.scaledHigh - tag.scale.scaledLow) * (value - tag.scale.rawLow) / (tag.scale.rawHigh - tag.scale.rawLow) + tag.scale.scaledLow;
                    } else if (tag.scale.mode === 'convertDateTime' && tag.scale.dateTimeFormat) {
                        value = dayjs(value).format(tag.scale.dateTimeFormat);
                    } else if (tag.scale.mode === 'convertTickTime' && tag.scale.dateTimeFormat) {
                        value = durationToTimeFormat(dayjs.duration(value), tag.scale.dateTimeFormat);
                    }
                }
                if (tag.format) {
                    value = +value.toFixed(tag.format);
                }
            } catch (err) { 
                console.error(err);
            }
        } else if (tag &&  tag.rawValue != null) {
            value = tag.rawValue;
            if (tag.scale) {
                if (tag.scale.mode === 'functionName' && tag.scale.functionName) {
                    try {
                            let _sn = this.msm_.getScriptByName(tag.scale.functionName);
                            if (_sn) {
                                _sn.parameters[0].value = value;
                                let res = this.msm_.runScriptWithReturn(_sn);
                                value = res;
                            }
                    } catch (err) {
                        console.log("You must define the function:" + tag.scale.functionName + " at server side in device-utils.js or in FUXA scripts!");
                    }
                }
            }
        }
        return value;
    },

    tagRawCalculator: function (value, tag) {
        var obj = {value: null };
        if (tag && utils.isNumber(value, obj)) {
            try {
                value = obj.value;
                if (tag.scale && tag.scale.mode === 'linear') {
                    value = tag.scale.rawLow + ((tag.scale.rawHigh - tag.scale.rawLow) * (value - tag.scale.scaledLow)) / (tag.scale.scaledHigh - tag.scale.scaledLow);
                }
            } catch (err) { 
                console.error(err);
            }
        }
        return value;
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