#!/usr/bin/env node

/**
 * The jira-changelog CLI
 */

import "core-js/stable";
import "regenerator-runtime/runtime";
import 'source-map-support/register';
import program from 'commander';
import path from 'path';
import Slack from './Slack';
import Entities from 'html-entities';

import { generateTemplateData, renderTemplate } from './template';
import {readConfigFile} from './Config';
import SourceControl from './SourceControl';
import Jira from './Jira';

runProgram();

/**
 * Parse command line arguments
 */
function commandLineArgs() {
  const pkg = require('../../package.json');
  program
    .version(pkg.version)
    .option(
      '-c, --config <filepath>',
      'Path to the config file.'
    )
    .option(
      '-r, --range <from>...<to>',
      'git commit range for changelog',
      parseRange
    )
    .option(
      '-d, --date <date>[...date]',
      'Only include commits after this date',
      parseRange
    )
    .option(
      '-s, --slack',
      'Automatically post changelog to slack (if configured)'
    )
    .option(
      '--release [release]',
      'Assign a release version to these stories'
    )
    .parse(process.argv);
}

/**
 * Run the main program
 */
async function runProgram() {
  try {
    commandLineArgs();

    // Determine the git workspace path
    let gitPath = process.cwd();
    if (program.args.length) {
      gitPath = program.args[0];
    }
    gitPath = path.resolve(gitPath);

    const config = readConfigFile(gitPath);
    const jira = new Jira(config);
    const source = new SourceControl(config);

    // Release flag used, but no name passed
    if (program.release === true) {
      if (typeof config.jira.generateReleaseVersionName !== 'function') {
        console.log("You need to define the jira.generateReleaseVersionName function in your config, if you're not going to pass the release version name in the command.")
        return;
      }
      program.release = await config.jira.generateReleaseVersionName();
    }

    // Get logs
    const range = getRangeObject(config);
    const commitLogs = await source.getCommitLogs(gitPath, range);
    const changelog = await jira.generate(commitLogs, program.release);

    // Render template
    const tmplData = await generateTemplateData(config, changelog, jira.releaseVersions);
    const changelogMessage = renderTemplate(config, tmplData);

    // Output to console
    const entitles = new Entities.AllHtmlEntities();
    console.log(entitles.decode(changelogMessage));

    // Post to slack
    if (program.slack) {
      postToSlack(config, tmplData, changelogMessage);
    }
  } catch(e) {
    console.error('Error: ', e.stack);
    console.log(e.message);
  }
}

/**
 * Post the changelog to slack
 *
 * @param {Object} config - The configuration object
 * @param {Object} data - The changelog data object.
 * @param {String} changelogMessage - The changelog message
 */
async function postToSlack(config, data, changelogMessage) {
  const slack = new Slack(config);

  if (!slack.isEnabled() || !config.slack.channel) {
    console.error('Error: Slack is not configured.');
    return;
  }

  console.log(`\nPosting changelog message to slack channel: ${config.slack.channel}...`);
  try {

    // Transform for slack
    if (typeof config.transformForSlack == 'function') {
      changelogMessage = await Promise.resolve(config.transformForSlack(changelogMessage, data));
    }

    // Post to slack
    await slack.postMessage(changelogMessage, config.slack.channel);
    console.log('Done');

  } catch(e) {
    console.log('Error: ', e);
  }
}

/**
 * Convert a range string formatted as "a...b" into an array.
 *
 * @param {String} rangeStr - The range string.
 * @return {Array}
 */
function parseRange(rangeStr) {
  return rangeStr.split(/\.{3,3}/);
}


/**
 * Construct the range object from the CLI arguments and config
 *
 * @param {Object} config - The config object provided by Config.getConfigForPath
 * @return {Object}
 */
function getRangeObject(config) {
  const range = {};
  const defaultRange = (config.sourceControl && config.sourceControl.defaultRange) ? config.sourceControl.defaultRange : {};

  if (program.range && program.range.length) {
    range.from = program.range[0];
    range.to = program.range[1];
  }
  if (program.dateRange && program.dateRange.length) {
    range.after = program.dateRange[0];
    if (program.dateRange.length > 1) {
      range.before = program.dateRange[1];
    }
  }

  // Use default range
  if (!Object.keys(range).length && Object.keys(defaultRange).length) {
    Object.assign(range, defaultRange);
  }

  if (!Object.keys(range).length){
      throw new Error('No range defined for the changelog.');
  }
  return range;
}
