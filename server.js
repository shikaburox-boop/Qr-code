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
let activeTables = {}; // 🆕 สำหรับเก็บข้อมูลโต๊ะที่กำลังใช้งานและเวลาหมดอายุ { "1": expireTime, "2": expireTime }

// 🆕 รูทหน้าแรกสุด (/) ให้เด้งไปหน้าแอดมินอัตโนมัติป้องกันอาการ Cannot GET /
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/admin.html');
});

io.on('connection', (socket) => {
    console.log('มีผู้ใช้งานเชื่อมต่อเข้ามา: ' + socket.id);

    // เมื่อเปิดหน้าแอดมิน ให้ส่งออเดอร์ปัจจุบันทั้งหมดไปให้ดู
    socket.emit('init-orders', activeOrders);

    // 🆕 1. ลอจิกเมื่อแอดมินกดเปิดโต๊ะใหม่จากหน้า admin.html
    socket.on('open-table', (data) => {
        activeTables[data.table] = parseInt(data.expires);
        console.log(`[ระบบ] ทำการเปิดโต๊ะ ${data.table} และเริ่มนับเวลาเรียบร้อย`);
    });

    // 🆕 2. ลอจิกตรวจสอบสถานะโต๊ะเมื่อลูกค้าสแกนเข้ามาที่หน้า table.html
    socket.on('check-table-status', (data, callback) => {
        const expireTime = activeTables[data.table];
        
        if (!expireTime) {
            // กรณีโต๊ะยังไม่ได้ถูกเปิด หรือกดเช็คบิลปิดโต๊ะไปแล้ว
            callback({ status: 'closed', message: 'โต๊ะนี้ยังไม่ได้เปิดระบบ หรือถูกเช็คบิลเรียบร้อยแล้ว' });
        } else if (Date.now() > expireTime) {
            // กรณีโต๊ะเปิดอยู่จริงแต่เวลาเกิน 90 นาทีแล้ว
            delete activeTables[data.table]; // ลบโต๊ะที่หมดเวลาออก
            callback({ status: 'expired', message: 'คิวสั่งอาหารสำหรับโต๊ะนี้หมดเวลา 90 นาทีแล้วครับ' });
        } else {
            // โต๊ะปกติและเวลาเหลือ สั่งอาหารได้!
            callback({ status: 'active', expires: expireTime });
        }
    });

    // 3. ลูกค้าส่งออเดอร์เข้ามา
    socket.on('submit-order', (data, callback) => {
        // 🆕 เช็คความปลอดภัยซ้ำอีกรอบ ว่าโต๊ะนี้โดนกดเช็คบิลระหว่างทางไปแล้วหรือยัง
        if (!activeTables[data.table]) {
            return callback({ success: false, message: 'ส่งออเดอร์ไม่ได้ เนื่องจากโต๊ะนี้ถูกเช็คบิลปิดไปแล้ว' });
        }

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
        
        // ส่งสัญญาณตอบกลับหน้าเว็บลูกค้าว่าเซิร์ฟเวอร์รับออเดอร์แล้ว
        callback({ success: true });
    });

    // 4. พนักงานกด "เสิร์ฟแล้ว"
    socket.on('mark-done', (orderId) => {
        if (activeOrders[orderId]) {
            activeOrders[orderId].status = "เสิร์ฟแล้ว";
            io.emit('order-updated', activeOrders);
        }
    });

    // 5. พนักงานกด "ชำระเงิน" (เคลียร์โต๊ะ)
    socket.on('clear-table', (tableNum) => {
        // 🆕 ลบสิทธิ์ของโต๊ะนี้ออกจากระบบทันที ลูกค้าจะใช้ลิงก์เดิมสั่งอาหารเพิ่มไม่ได้อีกต่อไป
        delete activeTables[tableNum];

        // ลบออเดอร์ทั้งหมดของโต๊ะนี้ออกจากหน้าจอห้องครัว
        Object.keys(activeOrders).forEach(id => {
            if (activeOrders[id].table === tableNum) {
                delete activeOrders[id];
            }
        });
        io.emit('order-updated', activeOrders);
        console.log(`[ระบบ] เคลียร์ออเดอร์และตัดสิทธิ์การสั่งอาหารของโต๊ะ ${tableNum} เรียบร้อย`);
    });
});

// รันที่พอร์ต 3000
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🚀 Socket.io Server กำลังทำงานที่พอร์ต http://localhost:${PORT}`);
});
