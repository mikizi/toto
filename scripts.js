document.addEventListener('DOMContentLoaded', () => {
    const fileUrl = 'Master_euro2024.xlsx';

    fetch(fileUrl)
        .then(response => response.arrayBuffer())
        .then(data => {
            const workbook = XLSX.read(data, {type: 'array'});
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(worksheet);

            displayTable(json);
        })
        .catch(error => console.error('Error fetching or processing Excel file:', error));
});

function parseHeader(header) {
    const headerMap = {
        '__EMPTY': 'Position',
        'Name': 'Username',
        'Score': 'Points',
        'winnwer': 'Champion',
        'Reward': 'Prize'
    };
    return headerMap[header] || header;
}

function getCountryFlag(country) {
    const countryMap = {
        'France': 'fr',
        'Germany': 'de',
        'England': 'gb',
        'Belgium': 'be',
        'Spain': 'es',
        'Switzerland': 'ch',
        'Hungary': 'hu',
        'Croatia': 'hr',
        'Italy': 'it',
        'Albania': 'al'
        // Add more countries as needed
    };
    return countryMap[country] || '';
}

function displayTable(data) {
    const table = document.getElementById('betsTable');
    table.innerHTML = '';

    if (data.length === 0) return;

    // Define the desired order of headers
    const orderedHeaders = ['__EMPTY', 'Name', 'Score', 'winnwer', 'Reward'];

    // Create table headers
    const headerRow = document.createElement('tr');
    orderedHeaders.forEach(header => {
        const th = document.createElement('th');
        const headerText = parseHeader(header);
        th.textContent = headerText;
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    // Create table rows
    data.forEach(row => {
        const tr = document.createElement('tr');
        orderedHeaders.forEach(header => {
            const td = document.createElement('td');
            let cellValue = row[header];

            if (header === 'Score') {
                cellValue = parseInt(cellValue, 10); // Format Points as integer
            } else if (header === 'winnwer') {
                const countryCode = getCountryFlag(cellValue);
                if (countryCode) {
                    cellValue = `<div class="flag-container"><span class="flag-icon flag-icon-${countryCode}"></span>${cellValue}</div>`;
                }
            } else if (header === 'Reward' && !cellValue) {
                cellValue = ''; // Handle undefined reward
            }

            td.innerHTML = cellValue;
            tr.appendChild(td);
        });
        table.appendChild(tr);
    });
}
