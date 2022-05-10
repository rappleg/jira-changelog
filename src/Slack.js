import fetch from 'node-fetch';

const MSG_SIZE_LIMIT = 4000;

/**
 * Manages the slack integration.
 */
export default class Slack {

  constructor(config) {
    this.config = config;
  }

  /**
   * Is the slack integration enabled
   */
  isEnabled() {
    return (this.config.slack && this.config.slack.webhookURL);
  }

  /**
   * Post message chunk to webhook URL
   *
   * @param {Object} body - The request body containing the text to POST to the webhook URL
   *
   * @return {Promise}
   */
  postChunk(body) {
    const url = `${this.config.slack.webhookURL}`;

    if (!this.isEnabled()) {
      return Promise.reject('The slack API is not configured.');
    }

    const messageBody = {
      "username": "Changelog notifier",
      "text": "Changelog published",
      "blocks": [
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": body
          }
        }
      ]
    };

    return fetch(url, { method: 'POST', body: JSON.stringify(messageBody), headers: { 'Content-Type': 'application/json' } })
    .then((data) => {
      return data;
    });
  }

  /**
   * Post a message to a slack channel.
   * If the message is longer than slack's limit, it will be cut into multiple messages.
   *
   * @param {String} text - The message to send to slack
   *
   * @return {Promise} Resolves when message has sent
   */
  postMessage(text) {

    // No message
    if (!text || !text.length) {
      return Promise.reject('No text to send to slack.');
    }

    // No slack integration
    if (!this.isEnabled()) {
      return Promise.resolve({});
    }

    const chunks = this.splitUpMessage(text);

    // Send all message chunks
    const sendPromise = chunks.reduce((promise, text) => {
      return promise.then(() => sendChunk(text));
    }, Promise.resolve());

    // Sends a single message to the webhook URL and returns a promise
    const self = this;
    function sendChunk(text) {
      return self.postChunk(text).then((response) => {
          if (response && !response.ok) {
            throw response.error;
          }
          return response;
        }
      );
    }

    return sendPromise;
  }

  /**
   * Cut a message into chunks that fit Slack's message length limits.
   * The text will be divided by newline characters, where possible.
   *
   * @param {String} text - The message text to split up.
   *
   * @return {Array}
   */
  splitUpMessage(text) {
    if (text.length <= MSG_SIZE_LIMIT) {
      return [text];
    }

    const lines = text.split('\n');
    const messages = [];
    const continuation = '...';
    const limit = MSG_SIZE_LIMIT - continuation.length;
    let block = '';

    lines.forEach((line) => {
      const tmpBlock = `${block}${line}\n`;

      // Within size limit
      if (tmpBlock.length <= MSG_SIZE_LIMIT) {
        block = tmpBlock;
      }
      // Bigger than size limit
      else {

        // Add last block and start new one
        if (block.length) {
          messages.push(block);
          block = line;
        }

        // No existing block, this line must be loner than the limit
        else {
          while (line.length > 0) {
            let last = line.substr(0, limit).trim();
            line = line.substr(limit).trim();

            // Add continuation characters
            if (line.length) {
              last += continuation;
              line = `${continuation}${line}`;
            }
            messages.push(last);
          }
        }
      }
    });
    if (block) {
      messages.push(block);
    }

    return messages;
  }
}
