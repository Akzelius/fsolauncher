/**
 * Returns the path with backslashes converted to forward slashes.
 *
 * @param {string} dir The path to convert.
 *
 * @returns {string} The converted path.
 */
function normalizePathSlashes( dir ) {
  return dir ? dir.replace( /\\/g, '/' ) : dir;
}

/**
 * Formats a string with unlimited arguments.
 *
 * @param {string} str The string to format.
 * @param {...any} args Values to replace.
 *
 * @returns {string} The formatted string.
 */
function strFormat( str, ...args ) {
  return args.reduce( ( s, v ) => s.replace( '%s', v ), str );
}

function initSentry() {
  const { dsn } = require( '../../sentry.config' );
  if ( dsn !== 'SENTRY_CI_DSN' ) {
    require( '@sentry/electron' ).init( {
      dsn,
      integrations: defaultIntegrations => defaultIntegrations.filter(
        integration => integration.name !== 'Net'
      ),
      beforeSend( event ) {
        return sanitizeEvent( event );
      },
    } );
  }
}

function sanitizeEvent( event ) {
  event = sanitizeExceptions( event );

  return event;
}

function sanitizeExceptions( event ) {
  if ( event.exceptions && event.exceptions.values ) {
    event.exceptions.values.forEach( ( exception ) => {
      if ( exception.stacktrace && exception.stacktrace.frames ) {
        exception.stacktrace.frames.forEach( ( frame ) => {
          frame.filename = obfuscatePath( frame.filename ); // Obfuscate local file paths
        } );
      }
    } );
  }
  return event;
}

function obfuscatePath( filePath ) {
  if ( typeof filePath !== 'string' ) {
    return filePath;
  }
  // Replace user directory with a placeholder
  const userDirectory = process.env.HOME || process.env.USERPROFILE;
  return filePath.replace( userDirectory, '[USER_DIR]' );
}

const SENTRY_MAX_ERROR_COUNT = 25; // Maximum number of same errors to capture per hour
const SENTRY_RESET_MINUTES = 60; // Reset error count after this many minutes

const sentryErrorCounts = {};

/**
 * Captures an error with Sentry.
 *
 * @param {Error} err The error to capture.
 * @param {Object} extra Extra data to send with the error.
 */
function captureWithSentry( err, extra ) {
  const { captureException } = require( '@sentry/electron' );

  const errorName = err.name + err.message;
  const currentError = sentryErrorCounts[ errorName ] || {
    count: 0,
    timestamp: new Date().getTime()
  };
  const expired = currentError.timestamp <= Date.now() - SENTRY_RESET_MINUTES * 60 * 1000;

  if ( currentError.count < SENTRY_MAX_ERROR_COUNT || expired ) {
    captureException( err, { extra } );

    // If it's been more than SENTRY_RESET_MINUTES since the last error,
    // reset the count.
    // Otherwise, increment it.
    sentryErrorCounts[ errorName ] = {
      count: expired ? 1 : ( currentError.count + 1 ),
      timestamp: new Date().getTime()
    };
  }
}

/**
 * Get JSON from a specified URL.
 *
 * @param {{ url: string, headers?: Object }} options The options for the request.
 *
 * @returns {Promise<any>} A promise that resolves with the JSON data from the response.
 */
function getJSON( options ) {
  const { net } = require( 'electron' );
  const { http, https } = require( 'follow-redirects' ).wrap( {
    http: net,
    https: net
  } );
  return new Promise( ( resolve, reject ) => {
    const httpModule = options.url.startsWith( 'https' ) ? https : http;
    const requestOptions = options.headers ? { headers: options.headers } : {};

    const req = httpModule.get( options.url, requestOptions, ( response ) => {
      console.info( 'getting json', { options, requestOptions } );

      let data = '';

      // A response status in the 200 range is a success status and can be resolved
      if ( response.statusCode >= 200 && response.statusCode <= 299 ) {
        response.on( 'data', chunk => data += chunk );
        response.on( 'end', () => {
          try {
            resolve( JSON.parse( data ) );
          } catch ( err ) {
            reject( err );
          }
        } );
      } else {
        reject( new Error( `Request failed with status code ${response.statusCode}` ) );
      }
    } );

    req.on( 'error', reject );
  } );
}

function getDisplayRefreshRate() {
  const { screen } = require( 'electron' );

  if ( process.platform == 'win32' ) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const refreshRate = primaryDisplay.displayFrequency;
    if ( refreshRate < 30 ) return 30;
    return refreshRate;
  }
  return 60;
}

module.exports = {
  normalizePathSlashes,
  strFormat,
  initSentry,
  captureWithSentry,
  getJSON,
  getDisplayRefreshRate
};