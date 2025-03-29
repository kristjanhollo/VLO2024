// Initialize socket connection
const socket = io();

// Define API base URL
const API_BASE_URL = 'https://discgolfmetrix.com/api.php?content=result&id=';

// Get DOM elements
const groupList = document.getElementById("groupList");
const checkedInCounter = document.getElementById("checkedInCounter");
const totalUsers = document.getElementById("totalUsers");
const filterButton = document.getElementById("filterButton");
const competitionTitle = document.getElementById("competitionTitle");
const apiIdInput = document.getElementById("apiIdInput");
const changeApiBtn = document.getElementById("changeApiBtn");
const statusMessage = document.getElementById("statusMessage");
const searchInput = document.getElementById("searchInput");
const updateDataBtn = document.getElementById("updateDataBtn");

// State variables
let groups = [];
let currentSearchQuery = ''; // Store the current search query
let filterCheckedIn = false; // Store the filter state for checked-in players/groups

// Function to display groups
function displayGroups(groups) {
    groupList.innerHTML = ''; // Clear previous groups
    groups.forEach(group => {
        const groupItem = document.createElement('div');
        groupItem.classList.add('group-item');

        const allCheckedInGroup = group.users.every(user => user.checkedIn);
        
        const groupHeader = document.createElement('div');
        groupHeader.classList.add('group-header');
        groupHeader.innerHTML = `
            <h3>${group.groupName}</h3>
            <label>
                <input type="checkbox" class="group-checkbox" ${group.users.every(u => u.checkedIn) ? 'checked' : ''}> Check-in all
            </label>
        `;

        const userList = document.createElement('ul');
        let allCheckedIn = true; // Assume all users are checked-in initially
        
        group.users.forEach(user => {
            const li = document.createElement('li');
            li.classList.toggle('checked-in', user.checkedIn); // Add checked-in class if true
            li.innerHTML = `
                <label for="${user.username}">
                    <input type="checkbox" id="${user.username}" class="check-in-checkbox" ${user.checkedIn ? 'checked' : ''}>
                    ${user.username}
                </label>
            `;

            const checkbox = li.querySelector('input[type="checkbox"]');
            checkbox.addEventListener('change', function () {
                socket.emit('checkInUser', {
                    username: user.username,
                    checkedIn: this.checked
                });
            });

            // If any user is not checked in, the group is not fully checked in
            if (!user.checkedIn) {
                allCheckedIn = false;
            }

            // Apply the hidden class based on the filter state for individual users
            if (filterCheckedIn && user.checkedIn) {
                li.classList.add('hidden');
            } else {
                li.classList.remove('hidden');
            }

            groupItem.style = allCheckedIn && filterCheckedIn ? 'display: none;' : '';
            li.style.display = user.checkedIn && filterCheckedIn ? 'none' : '';

            userList.appendChild(li);
        });

        // Hide fully checked-in groups if filter is active and all users are checked in
        if (filterCheckedIn && allCheckedIn) {
            groupItem.classList.add('hidden');
        } else {
            groupItem.classList.remove('hidden');
        }

        groupHeader.querySelector('.group-checkbox').addEventListener('change', function () {
            socket.emit('checkInGroup', {
                groupName: group.groupName,
                checkedIn: this.checked
            });
        });

        groupItem.appendChild(groupHeader);
        groupItem.appendChild(userList);
        groupList.appendChild(groupItem);
    });

    // After displaying, apply the current search filter
    filterGroups(currentSearchQuery);
}

// Function to filter groups and users based on search query
function filterGroups(searchQuery) {
    currentSearchQuery = searchQuery.toLowerCase(); // Store current search query
    const groupItems = Array.from(document.querySelectorAll('.group-item'));

    groupItems.forEach(groupItem => {
        const groupName = groupItem.querySelector('h3').textContent.toLowerCase();
        const userListItems = Array.from(groupItem.querySelectorAll('li'));

        // Filter users within the group based on search query
        let userMatches = false;
        userListItems.forEach(li => {
            const username = li.querySelector('label').textContent.toLowerCase();
            if (username.includes(currentSearchQuery)) {
                li.classList.remove('hidden'); // Show the user
                userMatches = true;
            } else {
                li.classList.add('hidden'); // Hide the user
            }
        });

        // Show the entire group if the group name matches the search query
        if (groupName.includes(currentSearchQuery)) {
            groupItem.classList.remove('hidden');  // Show group
            userListItems.forEach(li => li.classList.remove('hidden'));  // Show all users in the group
        } else if (userMatches) {
            groupItem.classList.remove('hidden');  // Show group but filtered users
        } else {
            groupItem.classList.add('hidden');  // Hide the group
        }
    });
}

// Function to toggle the filter for checked-in users and groups
function toggleFilter() {
    filterCheckedIn = !filterCheckedIn; // Toggle the filter state
    // Update the button text based on filter state
    filterButton.textContent = filterCheckedIn ? 'Filter ON' : 'Filter OFF';
    displayGroups(groups); // Re-display groups with the new filter state
}

// Function to show status message
function showStatusMessage(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.classList.remove('hidden', 'status-success', 'status-error');
    statusMessage.classList.add(isError ? 'status-error' : 'status-success');
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        statusMessage.classList.add('hidden');
    }, 5000);
}

// Function to extract competition ID from full URL
function extractCompetitionId(url) {
    // If it's already just the ID (a number), return it
    if (/^\d+$/.test(url)) {
        return url;
    }
    
    // Try to extract ID from full URL
    const idMatch = url.match(/id=(\d+)/);
    if (idMatch && idMatch[1]) {
        return idMatch[1];
    }
    
    // If no match, return the original value
    return url;
}

// ===== EVENT LISTENERS =====

// Search input handling
searchInput.addEventListener('focus', function() {
    searchInput.value = ''; // Clear the search bar
    filterGroups(''); // Reset displayed groups and users
});

searchInput.addEventListener('input', function() {
    filterGroups(searchInput.value); // Apply search filter when typing
});

// Filter button click
filterButton.addEventListener('click', toggleFilter);

// Update data button click
updateDataBtn.addEventListener('click', function() {
    socket.emit('updateDataFromAPI'); // Request to update data from API
});

// Change API button click
changeApiBtn.addEventListener('click', function() {
    const competitionId = apiIdInput.value.trim();
    if (competitionId) {
        // Extract just the ID if a full URL was pasted
        const cleanId = extractCompetitionId(competitionId);
        const newApiUrl = API_BASE_URL + cleanId;
        socket.emit('changeApiUrl', newApiUrl);
    } else {
        showStatusMessage('Please enter a valid competition ID', true);
    }
});

// ===== SOCKET EVENT HANDLERS =====

// Receive updated groups from the server
socket.on('loadGroups', (data) => {
    groups = data; // Store the groups data
    displayGroups(groups); // Display groups and maintain search filter
});

// Receive competition title from the server
socket.on('updateTitle', (title) => {
    competitionTitle.textContent = title;
    document.title = title; // Update page title as well
});

// Receive current API URL from the server
socket.on('currentApiUrl', (url) => {
    // Extract just the ID from the URL
    const idMatch = url.match(/id=(\d+)/);
    if (idMatch && idMatch[1]) {
        apiIdInput.value = idMatch[1];
    } else {
        apiIdInput.value = '';
    }
});

// Receive API success message
socket.on('apiSuccess', (message) => {
    showStatusMessage(message);
});

// Receive API error message
socket.on('apiError', (message) => {
    showStatusMessage(message, true);
});

// Update the checked-in counter
socket.on('checkedInCount', (data) => {
    checkedInCounter.textContent = data.checkedInUsers; // Update checked-in count
    totalUsers.textContent = data.totalUsers; // Update total user count
});