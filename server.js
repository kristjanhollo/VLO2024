const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const API_BASE_URL = 'https://discgolfmetrix.com/api.php?content=result&id=';

let groups = []; // To store the grouped players
let competitionTitle = ''; // Store the competition title
let currentApiUrl = API_BASE_URL + '3203240'; // Default API URL with initial ID

// Function to process and assign players to groups while keeping check-in status
const processPlayerGroupsWithCheckIn = (results) => {
    const groupMap = {};
    const existingUsers = {};

    // Map existing check-in statuses
    groups.forEach(group => {
        group.users.forEach(user => {
            existingUsers[user.username] = user.checkedIn; // Store check-in status by username
        });
    });

    // Iterate over each player in the Results array
    results.forEach(player => {
        const groupNumber = player.Group;
        const username = player.Name;

        // If the group does not exist in the map, create a new array for it
        if (!groupMap[groupNumber]) {
            groupMap[groupNumber] = [];
        }

        // Add the player to the appropriate group, preserving check-in status if it exists
        groupMap[groupNumber].push({
            username: username,
            checkedIn: existingUsers[username] || false // Preserve check-in status or default to false
        });
    });

    // Convert groupMap into the desired array format
    groups = Object.keys(groupMap).map(groupNumber => ({
        groupName: `Group ${groupNumber}`,
        users: groupMap[groupNumber]
    }));
};

// Helper function to ensure the API URL has the correct base
function ensureApiUrl(url) {
    // If the url is just a number, assume it's an ID
    if (/^\d+$/.test(url)) {
        return API_BASE_URL + url;
    }
    
    // If it doesn't start with the expected base URL, prepend it
    if (!url.startsWith(API_BASE_URL)) {
        // Try to extract an ID if it's a full URL
        const idMatch = url.match(/id=(\d+)/);
        if (idMatch && idMatch[1]) {
            return API_BASE_URL + idMatch[1];
        }
        
        // Otherwise, just append the whole string as an ID (might fail)
        return API_BASE_URL + url;
    }
    
    // It's already a full URL with the correct base
    return url;
}

// Function to fetch player data from the API
const fetchPlayerData = async (apiUrl = currentApiUrl) => {
    try {
        // Ensure the URL has the correct format
        const normalizedUrl = ensureApiUrl(apiUrl);
        
        const response = await axios.get(normalizedUrl);
        
        // Extract the competition title
        competitionTitle = response.data.Competition.Name || 'Check-In System';
        
        const results = response.data.Competition.Results; // Access the 'Results' array
        processPlayerGroupsWithCheckIn(results); // Process and group players while keeping check-in status
        
        console.log('Competition Title:', competitionTitle);
        console.log('Groups processed:', groups.length);
        
        // Update the current API URL
        currentApiUrl = normalizedUrl;
        
        return { title: competitionTitle, groups: groups };
    } catch (error) {
        console.error('Error fetching player data:', error.message);
        return { error: 'Failed to fetch data from API' };
    }
};

// Function to calculate the checked-in and total user counts
const calculateCheckedInCounts = () => {
    let totalUsers = 0;
    let checkedInUsers = 0;

    groups.forEach(group => {
        totalUsers += group.users.length;
        checkedInUsers += group.users.filter(user => user.checkedIn).length;
    });

    return { totalUsers, checkedInUsers };
};

// Emit updated counts whenever group data changes
const emitCheckedInCounts = () => {
    const counts = calculateCheckedInCounts();
    io.emit('checkedInCount', counts); // Send counts to all clients
};

// Fetch player data when the server starts
fetchPlayerData();

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Handle socket connection
io.on('connection', (socket) => {
    console.log('A user connected');

    // Send the current group list, title, and counts to the client when they connect
    socket.emit('loadGroups', groups);
    socket.emit('updateTitle', competitionTitle);
    socket.emit('currentApiUrl', currentApiUrl);
    emitCheckedInCounts();

    // Handle individual user check-in updates
    socket.on('checkInUser', (data) => {
        groups = groups.map(group => ({
            ...group,
            users: group.users.map(user =>
                user.username === data.username ? { ...user, checkedIn: data.checkedIn } : user
            )
        }));

        io.emit('loadGroups', groups); // Broadcast updated groups
        emitCheckedInCounts(); // Emit updated counts
    });

    // Handle group-level check-in updates
    socket.on('checkInGroup', (data) => {
        groups = groups.map(group =>
            group.groupName === data.groupName
                ? {
                    ...group,
                    users: group.users.map(user => ({ ...user, checkedIn: data.checkedIn }))
                }
                : group
        );

        io.emit('loadGroups', groups); // Broadcast updated groups
        emitCheckedInCounts(); // Emit updated counts
    });

    // Handle API URL change
    socket.on('changeApiUrl', async (newApiUrl) => {
        console.log('Changing API URL to:', newApiUrl);
        
        try {
            const result = await fetchPlayerData(newApiUrl);
            
            if (result.error) {
                socket.emit('apiError', result.error);
                return;
            }
            
            // Broadcast all updates
            io.emit('loadGroups', groups);
            io.emit('updateTitle', competitionTitle);
            io.emit('currentApiUrl', currentApiUrl);
            emitCheckedInCounts();
            
            socket.emit('apiSuccess', 'API data loaded successfully');
        } catch (error) {
            console.error('Error changing API URL:', error);
            socket.emit('apiError', 'Failed to fetch data from the new API URL');
        }
    });

    // Handle API data update
    socket.on('updateDataFromAPI', async () => {
        console.log('Updating data from API...');
        
        try {
            const result = await fetchPlayerData();
            
            if (result.error) {
                socket.emit('apiError', result.error);
                return;
            }
            
            // Broadcast all updates
            io.emit('loadGroups', groups);
            io.emit('updateTitle', competitionTitle);
            emitCheckedInCounts();
            
            socket.emit('apiSuccess', 'API data refreshed successfully');
        } catch (error) {
            console.error('Error updating from API:', error);
            socket.emit('apiError', 'Failed to refresh data from API');
        }
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

// Start the server on port 3000
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});