const express = require('express');
const app = express();
const http = require('http').createServer(app);
const cors = require('cors');

// เปิดใช้งาน CORS เพื่อให้หน้าเว็บสแกนข้ามเครือข่ายมาคุยได้
app.use(cors());
app.use(express.static('.')); // ให้เรียกใช้ไฟล์ html ในโฟลเดอร์นี้ได้

const io = require('socket.io')(http, {
    cors: {
        origin: "*", // ยอมรับการเชื่อมต่อจากทุก IP (เหมาะสำหรับมือถือสแกนเข้าคอม)
        methods: ["GET", "POST"]
    }
});

let activeOrders = {}; // สำหรับเก็บออเดอร์ชั่วคราวใน Server

io.on('connection', (socket) => {
    console.log('มีผู้ใช้งานเชื่อมต่อเข้ามา: ' + socket.id);

    // เมื่อเปิดหน้าแอดมิน ให้ส่งออเดอร์ปัจจุบันทั้งหมดไปให้ดู
    socket.emit('init-orders', activeOrders);

    // ลูกค้าส่งออเดอร์เข้ามา
    socket.on('submit-order', (data) => {
        const orderId = Date.now().toString(); // ใช้เวลาเป็นรหัสออเดอร์
        const newOrder = {
            id: orderId,
            table: data.table,
            items: data.items,
            totalPrice: data.totalPrice,
            status: "กำลังทำ"
        };
        
        activeOrders[orderId] = newOrder;

        // ยิงข้อมูลบอกหน้าแอดมินทุกเครื่องทันทีแบบ Real-time
        io.emit('order-updated', activeOrders);
    });

    // พนักงานกด "ทำเรียบร้อย"
    socket.on('mark-done', (orderId) => {
        if (activeOrders[orderId]) {
            activeOrders[orderId].status = "เสิร์ฟแล้ว";
            io.emit('order-updated', activeOrders);
        }
    });

    // พนักงานกด "ชำระเงิน" (เคลียร์โต๊ะ)
    socket.on('clear-table', (tableNum) => {
        // ลบออเดอร์ทั้งหมดของโต๊ะนี้
        Object.keys(activeOrders).forEach(id => {
            if (activeOrders[id].table === tableNum) {
                delete activeOrders[id];
            }
        });
        io.emit('order-updated', activeOrders);
    });
});

// รันที่พอร์ต 3000
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🚀 Socket.io Server กำลังทำงานที่พอร์ต http://localhost:${PORT}`);
});