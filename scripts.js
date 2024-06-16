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

            displayLastOrLiveGame(json);
            displayTable(json);

            // Adjust the card height after content is loaded
            const card = document.querySelector('.card');
            card.style.opacity = '0.9';

        })
        .catch(error => console.error('Error fetching or processing Excel file:', error));
});

function getCountryFlag(country) {
    const countryMap = {
        'Germany': 'de',
        'Scotland': 'gb-sct',
        'Hungary': 'hu',
        'Switzerland': 'ch',
        'Spain': 'es',
        'Croatia': 'hr',
        'Italy': 'it',
        'Albania': 'al',
        'Slovenia': 'si',
        'Denmark': 'dk',
        'Serbia': 'rs',
        'England': 'gb-eng',
        'Netherlands': 'nl',
        'France': 'fr',
        'Poland': 'pl',
        'Austria': 'at',
        'Ukraine': 'ua',
        'Slovakia': 'sk',
        'Belgium': 'be',
        'Romania': 'ro',
        'Portugal': 'pt',
        'Czech Republic': 'cz',
        'Georgia': 'ge',
        'Turkey': 'tr'
    };
    return countryMap[country] || '';
}

function displayLastOrLiveGame(data) {
    const gameInfo = document.getElementById('gameInfo');
    gameInfo.innerHTML = '';

    const now = new Date();
    let game = null;

    data.some((row, index) => {
        if (index < TOP_EMPTY_ROWS || index > USERS) {
            return;
        }

        const gameDate = row['__EMPTY_14'];
        const gameTimeFraction = row['__EMPTY_15'];
        const gameDateTime = parseExcelDateTime(gameDate, gameTimeFraction);
        const teams = row['__EMPTY_10'].split('-');
        const results = [row['__EMPTY_11'], row['__EMPTY_12']];

        if (gameDateTime <= now && results[0] !== undefined && results[1] !== undefined) {
            game = {
                gameDateTime,
                teams,
                results
            };
        }

        if (gameDateTime > now) {
            return game;
        }
    });

    if (game) {
        const team1Flag = getCountryFlag(game.teams[0].trim());
        const team2Flag = getCountryFlag(game.teams[1].trim());
        gameInfo.innerHTML = `
            <div class="game-info">
                <div class="team">
                    <span class="flag-icon flag-icon-${team1Flag}"></span>
                    ${game.teams[0].trim()}
                </div>
                <div class="result">
                    ${game.results[0]} - ${game.results[1]}
                </div>
                <div class="team">
                    ${game.teams[1].trim()}
                    <span class="flag-icon flag-icon-${team2Flag}"></span>
                </div>
            </div>
            <div class="datetime">
                ${formatDateTime(game.gameDateTime)}
            </div>
        `;
    }
}

function parseExcelDateTime(date, timeFraction) {
    const excelDate = new Date(date);
    const hours = Math.floor(timeFraction * 24);
    const minutes = Math.round((timeFraction * 24 - hours) * 60);
    excelDate.setHours(hours);
    excelDate.setMinutes(minutes);
    return excelDate;
}

function formatDateTime(date) {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Months are zero-based
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${day}-${month}-${year} ${hours}:${minutes}`;
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
    };

    // Define the desired order of headers
    const orderedHeaders = [
        enumHeaders.Position,
        enumHeaders.Username,
        enumHeaders.Points,
        enumHeaders.Champion,
        enumHeaders.Reward
    ];

    // Create table headers
    const headerRow = document.createElement('tr');
    const headers = ['Position', 'Username', 'Points', 'Champion', 'Reward'];
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
            const prefix = '__EMPTY_';
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
            }else if (headerIndex === 3) {
                td.classList.add('username');
                cellValue = cellValue.replaceAll('_', ' ');
            }

            td.innerHTML = cellValue;
            tr.appendChild(td);
        });
        table.appendChild(tr);
    });
}
