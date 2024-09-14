const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

// Sample groups with users and their check-in status
let groups = [
    { 
        groupName: 'Group A', 
        users: [
            { username: 'john_doe', checkedIn: false },
            { username: 'jane_smith', checkedIn: false },
            { username: 'michael_clark', checkedIn: false },
            { username: 'emily_watson', checkedIn: false }
        ]
    },
    { 
        groupName: 'Group B', 
        users: [
            { username: 'david_lee', checkedIn: false },
            { username: 'linda_jones', checkedIn: false },
            { username: 'charles_davis', checkedIn: false },
            { username: 'susan_miller', checkedIn: false }
        ]
    }
];

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

// Handle socket connection
io.on('connection', (socket) => {
    console.log('A user connected');

    // Send the current group list to the client when they connect
    socket.emit('loadGroups', groups);

    // Handle individual user check-in updates
    socket.on('checkInUser', (data) => {
        groups = groups.map(group => ({
            ...group,
            users: group.users.map(user => 
                user.username === data.username ? { ...user, checkedIn: data.checkedIn } : user
            )
        }));

        // Broadcast the updated groups to all connected clients
        io.emit('loadGroups', groups);
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

        // Broadcast the updated groups to all connected clients
        io.emit('loadGroups', groups);
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

server.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});
