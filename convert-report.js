const fs = require('fs');
const path = require('path');

const jsonPath = 'C:/Users/ksata/Downloads/import-report-4.json';
const csvOutputPath = path.join(__dirname, 'import-report.csv');

if (!fs.existsSync(jsonPath)) {
  console.error(`Error: File not found at ${jsonPath}`);
  process.exit(1);
}

try {
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const anomalies = data.anomalies || [];

  // CSV headers
  const headers = ['Row', 'Type', 'Severity', 'Description', 'Auto Fixed', 'Auto Fix Description', 'Resolution'];
  
  // Helper to escape CSV fields
  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '';
    let str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      str = str.replace(/"/g, '""');
      return `"${str}"`;
    }
    return str;
  };

  const csvRows = [headers.join(',')];

  for (const anomaly of anomalies) {
    const row = [
      escapeCsv(anomaly.row),
      escapeCsv(anomaly.type),
      escapeCsv(anomaly.severity),
      escapeCsv(anomaly.description),
      escapeCsv(anomaly.autoFixed),
      escapeCsv(anomaly.autoFixDescription),
      escapeCsv(anomaly.resolution)
    ];
    csvRows.push(row.join(','));
  }

  fs.writeFileSync(csvOutputPath, csvRows.join('\n'), 'utf8');
  console.log(`🚀 Success: Generated CSV report at ${csvOutputPath} with ${anomalies.length} entries.`);
} catch (err) {
  console.error('Failed to parse or write report:', err);
  process.exit(1);
}
