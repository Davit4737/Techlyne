

    // Пример динамических данных
    const totalDistEl = document.getElementById('total-distributed');
    const usersRecEl = document.getElementById('users-received');
    const tokensLeftEl = document.getElementById('tokens-left');

    if(totalDistEl) totalDistEl.innerText = '742,000';
    if(usersRecEl) usersRecEl.innerText = '371';
    if(tokensLeftEl) tokensLeftEl.innerText = '258,000';

    // Кнопка подключения кошелька
    const btnConnect = document.getElementById('connectWallet');
    if(btnConnect) btnConnect.addEventListener('click', connectWallet);
});

