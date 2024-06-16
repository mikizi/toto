const USERS = 70;
const TOP_EMPTY_ROWS = 1;
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
        'Albania': 'al',
        'Portugal': 'pt',
        'Netherlands': 'nl',
        // Add more countries as needed
    };
    return countryMap[country] || '';
}

function displayTable(data) {
    const table = document.getElementById('betsTable');
    table.innerHTML = '';

    if (data.length === 0) {
        return;
    }

    const enumHeaders = {
        'Position': 2,
        'Username': 3,
        'Champion': 4,
        'Points': 5,
        'Reward': 6
    }
    // Define the desired order of headers
    const orderedHeaders = [
        enumHeaders.Position,
        enumHeaders.Username,
        enumHeaders.Points,
        enumHeaders.Champion,
        enumHeaders.Reward,
     ];

    // Create table headers
    const headerRow = document.createElement('tr');
    const headers = ['Position', 'Username','Points', 'Champion' , 'Reward'];
    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header;
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    // Create table rows
    data.forEach((row, index) => {
        // Skip the first two rows as they are not relevant
        if (index < TOP_EMPTY_ROWS || index > USERS) {
            return;
        }

        const tr = document.createElement('tr');
        orderedHeaders.forEach(headerIndex => {
            const td = document.createElement('td');
            const prefix = '__EMPTY_'
            const header = prefix + headerIndex;
            let cellValue = row[header];

            if (headerIndex === 5) {
                cellValue = parseInt(cellValue, 10); // Format Points as integer
            } else if (headerIndex === 4) {
                const countryCode = getCountryFlag(cellValue);
                if (countryCode) {
                    cellValue = `<div class="flag-container"><span class="flag-icon flag-icon-${countryCode}"></span>${cellValue}</div>`;
                }
            } else if (headerIndex === 6 && !cellValue) {
                cellValue = ''; // Handle undefined reward
            }

            td.innerHTML = cellValue;
            tr.appendChild(td);
        });
        table.appendChild(tr);
    });
}

