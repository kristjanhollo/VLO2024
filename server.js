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
const DEFAULT_ID = '3203240';

// In-memory storage for competition data (Heroku-compatible)
let competitionsData = {};
let currentCompetitionId = DEFAULT_ID;

// Helper function to extract competition ID from URL
function extractCompetitionId(url) {
    if (/^\d+$/.test(url)) {
        return url;
    }
    
    const idMatch = url.match(/id=(\d+)/);
    return idMatch && idMatch[1] ? idMatch[1] : url;
}

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

// Get current competition data or empty object if not found
function getCurrentCompetition() {
    return competitionsData[currentCompetitionId] || {
        title: 'Loading...',
        groups: [],
        lastUpdated: null
    };
}

// Function to process and assign players to groups while keeping check-in status
const processPlayerGroupsWithCheckIn = (competitionId, results) => {
    // Get existing competition data or create new
    const existingData = competitionsData[competitionId] || { 
        title: 'Unknown Competition',
        groups: [],
        lastUpdated: null
    };
    
    const groupMap = {};
    const existingUsers = {};

    // Map existing check-in statuses if we have them
    if (existingData.groups && existingData.groups.length > 0) {
        existingData.groups.forEach(group => {
            group.users.forEach(user => {
                existingUsers[user.username] = user.checkedIn;
            });
        });
    }

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
            checkedIn: existingUsers[username] !== undefined ? existingUsers[username] : false
        });
    });

    // Convert groupMap into the desired array format
    const newGroups = Object.keys(groupMap).map(groupNumber => ({
        groupName: `Group ${groupNumber}`,
        users: groupMap[groupNumber]
    }));

    return newGroups;
};

// Function to fetch player data from the API
const fetchPlayerData = async (apiUrl) => {
    try {
        // Ensure the URL has the correct format
        const normalizedUrl = ensureApiUrl(apiUrl);
        const competitionId = extractCompetitionId(normalizedUrl);
        
        console.log(`Fetching data for competition ${competitionId}`);
        
        // Fetch fresh data from API
        const response = await axios.get(normalizedUrl);
        
        // Extract the competition title
        const competitionTitle = response.data.Competition.Name || 'Check-In System';
        
        const results = response.data.Competition.Results; // Access the 'Results' array
        const newGroups = processPlayerGroupsWithCheckIn(competitionId, results);
        
        // Update the competitions data store
        competitionsData[competitionId] = {
            title: competitionTitle,
            groups: newGroups,
            lastUpdated: new Date().toISOString()
        };
        
        // Update current competition ID
        currentCompetitionId = competitionId;
        
        console.log(`Updated competition ${competitionId}: ${competitionTitle} with ${newGroups.length} groups`);
        
        return { 
            id: competitionId,
            title: competitionTitle, 
            groups: newGroups 
        };
    } catch (error) {
        console.error('Error fetching player data:', error.message);
        return { error: 'Failed to fetch data from API' };
    }
};

// Function to calculate the checked-in and total user counts
const calculateCheckedInCounts = (groups) => {
    let totalUsers = 0;
    let checkedInUsers = 0;

    groups.forEach(group => {
        totalUsers += group.users.length;
        checkedInUsers += group.users.filter(user => user.checkedIn).length;
    });

    return { totalUsers, checkedInUsers };
};

// Update check-in status for a user
const updateUserCheckInStatus = (username, checkedIn) => {
    const competition = competitionsData[currentCompetitionId];
    if (!competition) return false;
    
    let updated = false;
    
    // Update the user's check-in status
    competition.groups = competition.groups.map(group => {
        const updatedUsers = group.users.map(user => {
            if (user.username === username) {
                updated = true;
                return { ...user, checkedIn };
            }
            return user;
        });
        
        return { ...group, users: updatedUsers };
    });
    
    return updated;
};

// Update check-in status for a group
const updateGroupCheckInStatus = (groupName, checkedIn) => {
    const competition = competitionsData[currentCompetitionId];
    if (!competition) return false;
    
    let updated = false;
    
    // Update all users in the group
    competition.groups = competition.groups.map(group => {
        if (group.groupName === groupName) {
            updated = true;
            return {
                ...group,
                users: group.users.map(user => ({ ...user, checkedIn }))
            };
        }
        return group;
    });
    
    return updated;
};

// Initialize the server
async function initServer() {
    // Load the default competition
    await fetchPlayerData(API_BASE_URL + DEFAULT_ID);
    
    // Serve static files from the "public" directory
    app.use(express.static(path.join(__dirname, 'public')));

    // Handle socket connection
    io.on('connection', (socket) => {
        console.log('A user connected');
        
        const currentCompetition = getCurrentCompetition();

        // Send the current competition data to the client when they connect
        socket.emit('loadGroups', currentCompetition.groups);
        socket.emit('updateTitle', currentCompetition.title);
        socket.emit('currentApiUrl', API_BASE_URL + currentCompetitionId);
        socket.emit('checkedInCount', calculateCheckedInCounts(currentCompetition.groups));

        // Handle individual user check-in updates
        socket.on('checkInUser', (data) => {
            const updated = updateUserCheckInStatus(data.username, data.checkedIn);
            
            if (updated) {
                const updatedCompetition = getCurrentCompetition();
                io.emit('loadGroups', updatedCompetition.groups);
                io.emit('checkedInCount', calculateCheckedInCounts(updatedCompetition.groups));
            }
        });

        // Handle group-level check-in updates
        socket.on('checkInGroup', (data) => {
            const updated = updateGroupCheckInStatus(data.groupName, data.checkedIn);
            
            if (updated) {
                const updatedCompetition = getCurrentCompetition();
                io.emit('loadGroups', updatedCompetition.groups);
                io.emit('checkedInCount', calculateCheckedInCounts(updatedCompetition.groups));
            }
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
                
                const updatedCompetition = getCurrentCompetition();
                
                // Broadcast all updates
                io.emit('loadGroups', updatedCompetition.groups);
                io.emit('updateTitle', updatedCompetition.title);
                io.emit('currentApiUrl', API_BASE_URL + currentCompetitionId);
                io.emit('checkedInCount', calculateCheckedInCounts(updatedCompetition.groups));
                
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
                // Use the current competition ID to refresh
                const apiUrl = API_BASE_URL + currentCompetitionId;
                const result = await fetchPlayerData(apiUrl);
                
                if (result.error) {
                    socket.emit('apiError', result.error);
                    return;
                }
                
                const updatedCompetition = getCurrentCompetition();
                
                // Broadcast all updates
                io.emit('loadGroups', updatedCompetition.groups);
                io.emit('updateTitle', updatedCompetition.title);
                io.emit('checkedInCount', calculateCheckedInCounts(updatedCompetition.groups));
                
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

    // Start the server
    server.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

// Start the server
initServer().catch(err => {
    console.error('Failed to initialize server:', err);
});