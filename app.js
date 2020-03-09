#!/usr/bin/env node

'use strict';

// CLI Prompt
const inquirer  = require('inquirer');
const chalk = require('chalk');
const clear = require('clear');
const figlet = require('figlet');
const inquirerFileTreeSelection = require('inquirer-file-tree-selection-prompt')

const fs = require('fs');
const csv = require('csv-parser');
const Tracking  = require('./lib/tracking.js');
const parseString = require('xml2js').parseString;
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const tracking = new Tracking('API KEY', 'API USER', 'API PASS');
tracking.setJsonResponse(true);

const throttledQueue = require('throttled-queue');
const throttle = throttledQueue(2000, 1000, true);
const nodemailer = require('nodemailer');
const ProgressBar = require("./lib/ProgressBar");
const Bar = new ProgressBar();


inquirer.registerPrompt('file-tree-selection', inquirerFileTreeSelection)

let file = '';
let outputName = '';
let trackingCount = 1;

const getApiResponse = (item, outputName, totalLength) => {
  // console.log(trackingCount, totalLength);
  let filteredKeys = [];
  Object.keys(item).filter((entry) => {
    if (entry !== 'emailExported' && entry !== 'Item Return Date2' && entry !== 'First_Name' && entry !== 'Last_Name' && entry !== 'Billing Name' && entry !== 'Name' && entry !== 'Billing Phone' && entry !== 'Item QTY' && entry !== 'Item Price' && entry !== 'Option' && entry !== 'Payment Type' && entry !== 'Item Status' && entry !== 'Order Status' && entry !== 'Order Number') {
      filteredKeys.push(entry);
    }
  })
  var filtered = filteredKeys.reduce((obj, key) => ( { ...obj, [key]: item[key] }), {} );
  let respObj = {};
  let resp = [];
  let trackingNum = item['Item Tracking'];
  throttle(() => {
    tracking.makeRequest({
      customerContext: 'Customer Data',
      trackingNumber: trackingNum
    }, (data, err) => {
      // try {
      if (!err) {
        if (data !== undefined) {
          handleResponse(data, outputName, totalLength, respObj, filtered)
        } else {
          console.error('Undefined')
        }
      }
    })
  })
}

const handleResponse = (data, outputName, totalLength, respObj, filtered) => {
  let responseStatus = data.TrackResponse.Response[0].ResponseStatusDescription[0];
  if (responseStatus !== 'Failure' && data.TrackResponse.Shipment[0] !== undefined) {
    let info = data.TrackResponse.Shipment[0];
    if (info.ShipTo !== undefined && info.ShipTo[0] !== undefined) {
      if (info.ShipTo[0].Address[0] !== undefined) {
        let address;
        let addressObj = info.ShipTo[0].Address[0]
        if (addressObj.PostalCode === undefined) {
          address = {
            'City': addressObj.City[0],
            'State': addressObj.StateProvinceCode[0],
          }
        } else {
          address = {
            'City': addressObj.City[0],
            'State': addressObj.StateProvinceCode[0],
            'Zip': `${addressObj.PostalCode[0]}`
          }
        }
        let scanArr = info.Package[0].Activity;
        let scanHistory = [];
        for (let i = 0; i < scanArr.length; i++) {
          let scanType = scanArr[i].Status[0].StatusType[0].Description[0];
          scanHistory.push(scanType);
        }
        let notPickedUp = [];
        let pickedUpBoolean = 'Y';
        for (let i = 0; i < scanHistory.length; i++) {
          if (scanHistory.length < 2) {
            pickedUpBoolean = 'N';
            notPickedUp.push(scanHistory[i]);
          } else {
            pickedUpBoolean = 'Y'
          }
        }
        respObj = {
          'Tracking': info.Package[0].TrackingNumber[0],
          'Type': info.Service[0].Description[0],
          'Delivered?': info.Package[0].DeliveryIndicator[0],
          'Latest Status': info.Package[0].Activity[0].Status[0].StatusType[0].Description[0],
          'Picked Up?': pickedUpBoolean,
          'Address': address
        };
        respObj.Address = Object.values(respObj.Address);
        respObj = Object.values(respObj);
        let newObj = {};
        newObj = {...respObj, ...filtered};
        let respArr = Object.values(respObj)
        let customerInfo = Object.values(filtered)
        let allInfoArr = [...respArr, ...customerInfo]
        var newLine= "\r\n";
        let fieldNames = 'Test';
        data = [
          JSON.stringify(allInfoArr.flat())
        ];
        writeFile(outputName, data[0], newLine, totalLength);
      }
    }
  } else {
    // console.log(err);
  }
}

let emailSent = false;

function writeFile(outputName, data, newLine, totalLength) {
  let num = increment();

  switch(true) {
    // Less than 1500
    case (totalLength < 1500):
    if (num >= totalLength) {
      if (emailSent === false) {
        sendMail(outputName);
      }
    } else {
      fs.appendFile(outputName, data + newLine, (err) => {})
    }
    break;
    // Less than 4000
    case (totalLength >= 1500 && totalLength <= 4000):
    if (num >= totalLength - 1) {
      sendMail(outputName)
    } else {
      fs.appendFile(outputName, data + newLine, (err) => {})
    }
    break;
    // More than 4000
    case (totalLength > 4000):
    if (num >= totalLength - 10) {
      if (emailSent === false) {
        sendMail(outputName);
      }
    } else {
      fs.appendFile(outputName, data + newLine, (err) => {})
    }
    break;
  }
  Bar.update(num, num, totalLength);
}

var increment = (function(n) {
  return function() {
    n += 1;
    return n;
  }
}(1));


const createHeaders = (arr, outputName) => {
  var newLine= "\r\n";
  let respHeaders = ['Tracking', 'Type', 'Delivered', 'Latest Status', 'Picked Up', 'City', 'State', 'Zip']
  let filteredKeys = [];
  Object.keys(arr[0]).filter((entry) => {
    if (entry !== 'emailExported' && entry !== 'Item Return Date2' && entry !== 'First_Name' && entry !== 'Last_Name' && entry !== 'Billing Name' && entry !== 'Name' && entry !== 'Billing Phone' && entry !== 'Item QTY' && entry !== 'Item Price' && entry !== 'Option' && entry !== 'Payment Type' && entry !== 'Item Status' && entry !== 'Order Status' && entry !== 'Order Number') {
      filteredKeys.push(entry);
    }
  })
  var filtered = filteredKeys.reduce((obj, key) => ({ ...obj, [key]: arr[key] }), {});
  filtered = Object.keys(filtered);
  let headers = [...respHeaders, ...filtered]
  fs.appendFile(outputName, headers + newLine, (err) => {});
}

let trackingArr = [];
let customerInfo = [];
this.trackingArr = trackingArr;
this.customerInfo = customerInfo;

const readFile = (file) => {
  let totalLength = 0;
  let fileStream = fs.createReadStream(file)
  .on('error', () => {})
  .pipe(csv())
  .on('data', (row) => {
    if (row['Item Tracking'].length !== 0) {
      this.customerInfo.push(row)
      this.trackingArr.push(row['Item Tracking']);
    }
  })
  .on('end', (err) => {
    if (!err) {
      Bar.init(this.customerInfo.length)
      createHeaders(this.customerInfo, outputName);
      this.customerInfo.forEach((customer, i) => {
        setTimeout(function() {
          getApiResponse(customer, outputName, customerInfo.length)
        }, 50)
      })
    } else {
      console.error('There has been a problem reading your file.');
    }
  })
}

clear();
console.log(
  chalk.yellow(
    figlet.textSync('J McLaughlin - UPS API', { horizontalLayout: 'full' })
  )
);


let transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: '<<< USER >>>',
    pass: '<<< PASS >>>',
  }
})
var questions = [
  {
    type: 'input',
    name: 'filename',
    message: "What's the name of the file you would like to use?"
  },
  {
    type: 'input',
    name: 'outputName',
    message: "Please enter a name for the output file."
  }
]

let fileTreeQuestions = [
  {
    type: 'file-tree-selection',
    name: 'filename',
    message: 'Please choose the file you would like to use:'
  },
  {
    type: 'input',
    name: 'outputName',
    message: 'What would you like to name the output?'
  }
]

let answerObj = {};

const initialize = () => {
  inquirer.prompt(fileTreeQuestions).then(answers => {
    file = answers['filename']
    outputName = `${answers['outputName']}.csv`
    readFile(file, outputName);
  });
}

const sendMail = (outputName) => {
  emailSent = true;
  let pathStr = __dirname;
  let path = pathStr + '/' + outputName;
  const message = {
    from: '<<< VISIBLE NAME >>> " <<<< EMAIL >>>>',
    to: "ezra14@ethereal.email, <<< EMAIL >>>",
    subject: `UPS Pending shipments for ${outputName} ✔`,
    text: `Below are your results for ${outputName}`,
    html: `Below are your results for ${outputName}`,
    attachments: [
      {
        filename: outputName,
        path: path
      }
    ]
  }
  transporter.sendMail(message, function(err, info) {
    if (err) {
      console.log(err);
    } else {
      console.log(info);
    }
  })
}

// Run
initialize();
