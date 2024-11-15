const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

let groups = []; // To store the grouped players

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

// Function to fetch player data from the API
const fetchPlayerData = async () => {
    try {
        const response = await axios.get('https://discgolfmetrix.com/api.php?content=result&id=3139142');
        const results = response.data.Competition.Results; // Access the 'Results' array
        processPlayerGroupsWithCheckIn(results); // Process and group players while keeping check-in status
        console.log('Groups processed:', groups);
    } catch (error) {
        console.error('Error fetching player data:', error);
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

// Serve static files (the HTML page) from the "public" directory
app.use(express.static('public'));

// Handle socket connection
io.on('connection', (socket) => {
    console.log('A user connected');

    // Send the current group list and counts to the client when they connect
    socket.emit('loadGroups', groups);
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

    // Handle API data update
    socket.on('updateDataFromAPI', async () => {
        console.log('Updating data from API...');
        await fetchPlayerData(); // Fetch updated data
        io.emit('loadGroups', groups); // Broadcast updated groups
        emitCheckedInCounts(); // Emit updated counts
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

// Start the server on port 3000
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
