var winston = require('winston');
var moment = require('moment');

/**
 * Creates the winston logger object, and returns it.
 *
 * For information on how to use the logger, look at the Winston module documentation.
 *
 * @param log_folder - The absolute path to the folder where logs are stored.
 * @return the winston logger object that will be used for logging.
 */
function build_logger(log_folder) {
    var logger = winston.createLogger({
        transports: [
            new (winston.transports.Console)({
                handleExceptions: true,
                handleRejections: true
            }),
            new (winston.transports.File)({
                filename: log_folder + '/modbot_' + moment().format('YYYY_MM_DD_HH_mm_ss') + ".log",
                handleExceptions: true,
                handleRejections: true
            })
        ]
    });

    return logger;
}

module.exports = {build_logger};
